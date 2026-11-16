// Copper Deck Helper für Windows (natives Programm).
//
// Wird bei der Installation mit dem csc.exe des .NET Framework 4.x gebaut, das auf jedem Windows 10/11
// vorhanden ist (siehe scripts/install.ps1). Deshalb nur C#-5-Sprachmittel: keine String-Interpolation,
// kein ?., keine Ausdrucks-Member.
//
// Aufruf wie das macOS-Gegenstück: Unterbefehle mit Argument-Array, Antwort als eine JSON-Zeile auf stdout.
//   run                         Launcher: startet node versteckt und startet ihn nach einem Absturz neu
//   stop                        laufenden Launcher (und node) beenden
//   list-apps                   Apps aus shell:AppsFolder (Startmenü, inkl. Store-Apps): [{id,name}]
//   app-icon <id> <out> <px>    App-Icon als PNG
//   launch <id>                 App starten bzw. ein offenes Fenster nach vorne holen
//   open-url <url>              http/https im Standardbrowser
//   hotkey <key> [mods…]        Tastenkombination (SendInput)
//   insert-text <text>          Text/Emoji tippen (SendInput, Unicode)
//   tile-windows                letzte 4 Fenster anordnen
//   notify <title> <body>       Mitteilung (Infobereich, unter Windows 10/11 als Benachrichtigung)
//   permissions                 Windows kennt keine Berechtigungsdialoge wie macOS: immer "granted"
//   convert-image <in> <out> <maxPx>   PNG/JPEG/WebP prüfen und als PNG neu schreiben
//   create-shortcut <target> <name>    Verknüpfung im Startmenü (Ordner "Copper Deck")

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Windows.Media.Imaging;

namespace CopperDeck
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 0) return Fail("Unterbefehl fehlt");
            try
            {
                switch (args[0])
                {
                    case "run": return Launcher.Run();
                    case "stop": return Launcher.Stop();
                    case "list-apps": return Apps.List();
                    case "app-icon": return Apps.Icon(args);
                    case "launch": return Apps.Launch(args);
                    case "open-url": return OpenUrl(args);
                    case "hotkey": return Input.Hotkey(args);
                    case "insert-text": return Input.InsertText(args);
                    case "tile-windows": return Windows.Tile();
                    case "notify": return Notify(args);
                    case "permissions":
                        Json.Emit(Json.Obj("ok", true, "accessibility", "granted", "automation", "granted", "notifications", "granted"));
                        return 0;
                    case "convert-image": return ConvertImage(args);
                    case "create-shortcut": return Apps.CreateShortcut(args);
                    default: return Fail("Unbekannter Unterbefehl: " + args[0]);
                }
            }
            catch (Exception e)
            {
                return Fail(e.GetType().Name + ": " + e.Message);
            }
        }

        internal static int Fail(string message)
        {
            Json.Emit(Json.Obj("ok", false, "error", message));
            return 1;
        }

        internal static int FailCode(string code, string message)
        {
            Json.Emit(Json.Obj("ok", false, "error", code, "message", message));
            return 3;
        }

        private static int OpenUrl(string[] args)
        {
            if (args.Length != 2) return Fail("Aufruf: open-url <url>");
            Uri u;
            if (!Uri.TryCreate(args[1], UriKind.Absolute, out u) || (u.Scheme != "http" && u.Scheme != "https"))
                return FailCode("invalid_url", "Nur http- und https-Links sind erlaubt.");
            ProcessStartInfo psi = new ProcessStartInfo(u.AbsoluteUri);
            psi.UseShellExecute = true;
            Process.Start(psi);
            Json.Emit(Json.Obj("ok", true));
            return 0;
        }

        private static int Notify(string[] args)
        {
            if (args.Length != 3) return Fail("Aufruf: notify <title> <body>");
            using (NotifyIcon icon = new NotifyIcon())
            {
                icon.Icon = SystemIcons.Information;
                icon.Text = "Copper Deck";
                icon.Visible = true;
                icon.ShowBalloonTip(10000, args[1], args[2], ToolTipIcon.Info);
                // Kurz Nachrichten verarbeiten, damit die Benachrichtigung angezeigt wird.
                DateTime until = DateTime.UtcNow.AddSeconds(7);
                while (DateTime.UtcNow < until)
                {
                    Application.DoEvents();
                    Thread.Sleep(50);
                }
                icon.Visible = false;
            }
            Json.Emit(Json.Obj("ok", true));
            return 0;
        }

        /// <summary>Dekodiert über WIC (PNG, JPEG, WebP mit installiertem Codec) und schreibt ein PNG ohne Metadaten.</summary>
        private static int ConvertImage(string[] args)
        {
            int max;
            if (args.Length != 4 || !int.TryParse(args[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out max) || max < 16 || max > 2048)
                return Fail("Aufruf: convert-image <in> <out> <maxPx>");
            BitmapSource src;
            using (FileStream fs = File.OpenRead(args[1]))
            {
                BitmapDecoder dec = BitmapDecoder.Create(fs, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                if (dec.Frames.Count == 0) return Fail("Kein Bild");
                src = dec.Frames[0];
            }
            double scale = Math.Min(1.0, (double)max / Math.Max(src.PixelWidth, src.PixelHeight));
            BitmapSource outImg = scale < 1.0
                ? (BitmapSource)new TransformedBitmap(src, new System.Windows.Media.ScaleTransform(scale, scale))
                : src;
            PngBitmapEncoder enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(outImg));
            using (FileStream o = File.Create(args[2])) enc.Save(o);
            Json.Emit(Json.Obj("ok", true, "width", outImg.PixelWidth, "height", outImg.PixelHeight));
            return 0;
        }
    }

    // ---------------------------------------------------------------- Launcher

    /// <summary>
    /// Ersatz für launchd/KeepAlive: startet node versteckt (kein Konsolenfenster) und startet ihn nach
    /// einem Ende neu (1 s, 2 s, 4 s … höchstens 30 s). Nur eine Instanz pro Benutzer (Mutex).
    /// </summary>
    internal static class Launcher
    {
        private const string MutexName = "Local\\CopperDeckHelper";
        private const string StopEventName = "Local\\CopperDeckHelperStop";

        public static int Run()
        {
            bool created;
            using (Mutex m = new Mutex(true, MutexName, out created))
            {
                if (!created) return Program.Fail("Copper Deck läuft bereits.");
                string dir = AppDomain.CurrentDomain.BaseDirectory;
                string launchFile = Path.Combine(dir, "launch.json");
                string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CopperDeck", "Logs");
                Directory.CreateDirectory(logDir);
                string logFile = Path.Combine(logDir, "launcher.log");
                using (EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.ManualReset, StopEventName))
                {
                    int delayMs = 1000;
                    while (true)
                    {
                        string node, script;
                        if (!ReadLaunch(launchFile, out node, out script))
                        {
                            Log(logFile, "launch.json fehlt oder ist ungültig: " + launchFile);
                            return 1;
                        }
                        DateTime started = DateTime.UtcNow;
                        Process p = Start(node, script, logFile);
                        if (p == null)
                        {
                            Log(logFile, "node konnte nicht gestartet werden: " + node);
                        }
                        else
                        {
                            // Warten bis node endet oder "stop" kommt.
                            WaitHandle[] handles = new WaitHandle[] { stop, new ProcessWaitHandle(p) };
                            int which = WaitHandle.WaitAny(handles);
                            if (which == 0)
                            {
                                try { if (!p.HasExited) p.Kill(); } catch (Exception) { }
                                Log(logFile, "Beendet (stop)");
                                return 0;
                            }
                            Log(logFile, "node beendet mit Code " + p.ExitCode);
                            if ((DateTime.UtcNow - started).TotalSeconds > 60) delayMs = 1000;
                        }
                        if (stop.WaitOne(delayMs)) return 0;
                        delayMs = Math.Min(delayMs * 2, 30000);
                    }
                }
            }
        }

        public static int Stop()
        {
            EventWaitHandle ev;
            if (!EventWaitHandle.TryOpenExisting(StopEventName, out ev))
            {
                Json.Emit(Json.Obj("ok", true, "running", false));
                return 0;
            }
            using (ev) ev.Set();
            // Warten, bis der Launcher den Mutex freigibt.
            for (int i = 0; i < 50; i++)
            {
                Mutex m;
                if (!Mutex.TryOpenExisting(MutexName, out m)) break;
                m.Dispose();
                Thread.Sleep(100);
            }
            Json.Emit(Json.Obj("ok", true, "running", true));
            return 0;
        }

        private static Process Start(string node, string script, string logFile)
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, Quote(script) + " serve");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["COPPER_DECK_CONTEXT"] = "app";
            psi.EnvironmentVariables["COPPER_DECK_NATIVE"] = Process.GetCurrentProcess().MainModule.FileName;
            try
            {
                Process p = Process.Start(psi);
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(logFile, e.Data); };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(logFile, "ERR " + e.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                return p;
            }
            catch (Exception e)
            {
                Log(logFile, e.Message);
                return null;
            }
        }

        private static string Quote(string s)
        {
            return "\"" + s.Replace("\"", "") + "\"";
        }

        private static bool ReadLaunch(string file, out string node, out string script)
        {
            node = null;
            script = null;
            if (!File.Exists(file)) return false;
            string text = File.ReadAllText(file, Encoding.UTF8);
            node = Json.ReadString(text, "node");
            script = Json.ReadString(text, "script");
            return !string.IsNullOrEmpty(node) && !string.IsNullOrEmpty(script);
        }

        private static readonly object LogLock = new object();
        private static void Log(string file, string line)
        {
            lock (LogLock)
            {
                try
                {
                    FileInfo fi = new FileInfo(file);
                    if (fi.Exists && fi.Length > 5 * 1024 * 1024) File.Delete(file);
                    File.AppendAllText(file, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " " + line + Environment.NewLine, Encoding.UTF8);
                }
                catch (Exception) { }
            }
        }

        private sealed class ProcessWaitHandle : WaitHandle
        {
            public ProcessWaitHandle(Process p)
            {
                SafeWaitHandle = new Microsoft.Win32.SafeHandles.SafeWaitHandle(p.Handle, false);
            }
        }
    }

    // ---------------------------------------------------------------- Apps

    internal static class Apps
    {
        private static dynamic AppsFolder()
        {
            Type t = Type.GetTypeFromProgID("Shell.Application");
            dynamic shell = Activator.CreateInstance(t);
            return shell.NameSpace("shell:AppsFolder");
        }

        /// <summary>Alle Einträge von shell:AppsFolder (wie Get-StartApps): Name + AppUserModelID.</summary>
        public static int List()
        {
            dynamic folder = AppsFolder();
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"apps\":[");
            bool first = true;
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (dynamic item in folder.Items())
            {
                string name = item.Name as string;
                string id = item.Path as string;
                if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(id) || !seen.Add(id)) continue;
                if (id.Length > 260) continue;
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"id\":").Append(Json.Str(id)).Append(",\"name\":").Append(Json.Str(name)).Append('}');
            }
            sb.Append("]}");
            Console.Out.WriteLine(sb.ToString());
            return 0;
        }

        /// <summary>Icon über IShellItemImageFactory (bis 256 px, mit Transparenz).</summary>
        public static int Icon(string[] args)
        {
            int px;
            if (args.Length != 4 || !int.TryParse(args[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out px) || px < 16 || px > 512)
                return Program.Fail("Aufruf: app-icon <id> <out.png> <px>");
            Guid iid = typeof(IShellItemImageFactory).GUID;
            IShellItemImageFactory factory;
            int hr = Native.SHCreateItemFromParsingName("shell:AppsFolder\\" + args[1], IntPtr.Zero, ref iid, out factory);
            if (hr != 0 || factory == null) return Program.FailCode("app_not_found", "App nicht gefunden");
            IntPtr hbmp;
            Native.SIZE size;
            size.cx = px;
            size.cy = px;
            hr = factory.GetImage(size, Native.SIIGBF_BIGGERSIZEOK | Native.SIIGBF_ICONONLY, out hbmp);
            if (hr != 0 || hbmp == IntPtr.Zero) return Program.Fail("Kein Icon (HRESULT " + hr.ToString("X8") + ")");
            try
            {
                using (Bitmap bmp = FromHbitmapWithAlpha(hbmp))
                using (Bitmap scaled = new Bitmap(px, px, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(scaled))
                    {
                        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g.Clear(Color.Transparent);
                        g.DrawImage(bmp, 0, 0, px, px);
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[2])));
                    scaled.Save(args[2], ImageFormat.Png);
                }
            }
            finally
            {
                Native.DeleteObject(hbmp);
            }
            Json.Emit(Json.Obj("ok", true));
            return 0;
        }

        /// <summary>Image.FromHbitmap verwirft den Alphakanal; deshalb die Pixel als PArgb neu interpretieren.</summary>
        private static Bitmap FromHbitmapWithAlpha(IntPtr hbmp)
        {
            Bitmap raw = Image.FromHbitmap(hbmp);
            if (Image.GetPixelFormatSize(raw.PixelFormat) < 32) return raw;
            Rectangle r = new Rectangle(0, 0, raw.Width, raw.Height);
            BitmapData data = raw.LockBits(r, ImageLockMode.ReadOnly, raw.PixelFormat);
            try
            {
                using (Bitmap view = new Bitmap(data.Width, data.Height, data.Stride, PixelFormat.Format32bppPArgb, data.Scan0))
                {
                    return view.Clone(r, PixelFormat.Format32bppArgb);
                }
            }
            finally
            {
                raw.UnlockBits(data);
                raw.Dispose();
            }
        }

        /// <summary>
        /// Läuft die App schon (Fenster eines Prozesses mit derselben .exe), wird dieses Fenster nach vorne geholt.
        /// Sonst startet sie über shell:AppsFolder (funktioniert für Desktop- und Store-Apps).
        /// </summary>
        public static int Launch(string[] args)
        {
            if (args.Length != 2) return Program.Fail("Aufruf: launch <id>");
            string id = args[1];
            dynamic folder = AppsFolder();
            dynamic found = null;
            foreach (dynamic item in folder.Items())
            {
                string p = item.Path as string;
                if (p != null && string.Equals(p, id, StringComparison.OrdinalIgnoreCase)) { found = item; break; }
            }
            if (found == null) return Program.FailCode("app_not_found", "Diese App ist auf dem PC nicht installiert.");

            string exe = null;
            try { exe = found.ExtendedProperty("System.Link.TargetParsingPath") as string; } catch (Exception) { }
            if (string.IsNullOrEmpty(exe) && id.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(id)) exe = id;
            if (!string.IsNullOrEmpty(exe) && exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                IntPtr wnd = Windows.FindMainWindowOf(exe);
                if (wnd != IntPtr.Zero)
                {
                    bool fg = Windows.BringToFront(wnd);
                    Json.Emit(Json.Obj("ok", true, "activated", true, "foreground", fg));
                    return 0;
                }
            }
            ProcessStartInfo psi = new ProcessStartInfo("shell:AppsFolder\\" + id);
            psi.UseShellExecute = true;
            Process.Start(psi);
            Json.Emit(Json.Obj("ok", true, "activated", false));
            return 0;
        }

        /// <summary>Verknüpfung im Startmenü des Benutzers, damit ein beliebiges Programm in der App-Auswahl erscheint.</summary>
        public static int CreateShortcut(string[] args)
        {
            if (args.Length != 3) return Program.Fail("Aufruf: create-shortcut <ziel.exe> <name>");
            string target = Path.GetFullPath(args[1]);
            if (!File.Exists(target)) return Program.Fail("Datei nicht gefunden: " + target);
            string name = args[2];
            foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
            if (name.Trim().Length == 0) return Program.Fail("Name fehlt");
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Copper Deck");
            Directory.CreateDirectory(dir);
            string lnk = Path.Combine(dir, name + ".lnk");
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(t);
            dynamic sc = shell.CreateShortcut(lnk);
            sc.TargetPath = target;
            sc.WorkingDirectory = Path.GetDirectoryName(target);
            sc.Save();
            Json.Emit(Json.Obj("ok", true, "shortcut", lnk));
            return 0;
        }
    }

    // ---------------------------------------------------------------- Tastatur

    internal static class Input
    {
        private static readonly Dictionary<string, ushort> Special = new Dictionary<string, ushort>
        {
            { "space", 0x20 }, { "return", 0x0D }, { "tab", 0x09 }, { "escape", 0x1B }, { "delete", 0x08 }, { "forwarddelete", 0x2E },
            { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 }, { "home", 0x24 }, { "end", 0x23 },
            { "pageup", 0x21 }, { "pagedown", 0x22 },
            { "f1", 0x70 }, { "f2", 0x71 }, { "f3", 0x72 }, { "f4", 0x73 }, { "f5", 0x74 }, { "f6", 0x75 },
            { "f7", 0x76 }, { "f8", 0x77 }, { "f9", 0x78 }, { "f10", 0x79 }, { "f11", 0x7A }, { "f12", 0x7B },
        };

        /// <summary>Tasten, die als "erweitert" gesendet werden müssen (sonst Ziffernblock).</summary>
        private static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x2E, 0x26, 0x28, 0x25, 0x27, 0x24, 0x23, 0x21, 0x22, 0x5B };

        /// <summary>Modifier wie auf der Tastatur: ⌘-Position = Windows-Taste, ⌥ = Alt, ⌃ = Strg.</summary>
        private static readonly Dictionary<string, ushort> Mods = new Dictionary<string, ushort>
        {
            { "command", 0x5B }, { "option", 0x12 }, { "control", 0x11 }, { "shift", 0x10 },
        };

        public static int Hotkey(string[] args)
        {
            if (args.Length < 2) return Program.Fail("Aufruf: hotkey <taste> [modifier…]");
            ushort vk;
            string key = args[1];
            if (!Special.TryGetValue(key, out vk))
            {
                if (key.Length != 1) return Program.Fail("Unbekannte Taste: " + key);
                char c = key[0];
                if (c >= '0' && c <= '9') vk = (ushort)c;
                else if (c >= 'a' && c <= 'z')
                {
                    // Buchstabe im aktiven Tastaturlayout (Schweizerdeutsch: Z und Y vertauscht).
                    short scan = Native.VkKeyScanW(c);
                    vk = scan == -1 ? (ushort)char.ToUpperInvariant(c) : (ushort)(scan & 0xFF);
                }
                else return Program.Fail("Unbekannte Taste: " + key);
            }
            List<ushort> mods = new List<ushort>();
            for (int i = 2; i < args.Length; i++)
            {
                ushort m;
                if (!Mods.TryGetValue(args[i], out m)) return Program.Fail("Unbekannter Modifier: " + args[i]);
                if (!mods.Contains(m)) mods.Add(m);
            }
            string elevated = Windows.ForegroundElevatedName();
            if (elevated != null) return Program.FailCode("elevated", elevated);

            List<Native.INPUT> seq = new List<Native.INPUT>();
            foreach (ushort m in mods) seq.Add(Key(m, false));
            seq.Add(Key(vk, false));
            seq.Add(Key(vk, true));
            for (int i = mods.Count - 1; i >= 0; i--) seq.Add(Key(mods[i], true));
            if (!Send(seq)) return Program.Fail("SendInput fehlgeschlagen");
            Json.Emit(Json.Obj("ok", true));
            return 0;
        }

        /// <summary>Tippt Text als Unicode-Zeichen (kein Umweg über die Zwischenablage).</summary>
        public static int InsertText(string[] args)
        {
            if (args.Length != 2 || args[1].Length == 0 || args[1].Length > 64) return Program.Fail("Aufruf: insert-text <text>");
            string elevated = Windows.ForegroundElevatedName();
            if (elevated != null) return Program.FailCode("elevated", elevated);
            List<Native.INPUT> seq = new List<Native.INPUT>();
            foreach (char c in args[1])
            {
                seq.Add(Unicode(c, false));
                seq.Add(Unicode(c, true));
            }
            if (!Send(seq)) return Program.Fail("SendInput fehlgeschlagen");
            Json.Emit(Json.Obj("ok", true));
            return 0;
        }

        private static bool Send(List<Native.INPUT> seq)
        {
            Native.INPUT[] arr = seq.ToArray();
            uint sent = Native.SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(Native.INPUT)));
            return sent == arr.Length;
        }

        private static Native.INPUT Key(ushort vk, bool up)
        {
            Native.INPUT i = new Native.INPUT();
            i.type = Native.INPUT_KEYBOARD;
            i.u.ki.wVk = vk;
            i.u.ki.wScan = (ushort)Native.MapVirtualKeyW(vk, 0);
            i.u.ki.dwFlags = (up ? Native.KEYEVENTF_KEYUP : 0u) | (Extended.Contains(vk) ? Native.KEYEVENTF_EXTENDEDKEY : 0u);
            return i;
        }

        private static Native.INPUT Unicode(char c, bool up)
        {
            Native.INPUT i = new Native.INPUT();
            i.type = Native.INPUT_KEYBOARD;
            i.u.ki.wVk = 0;
            i.u.ki.wScan = c;
            i.u.ki.dwFlags = Native.KEYEVENTF_UNICODE | (up ? Native.KEYEVENTF_KEYUP : 0u);
            return i;
        }
    }

    // ---------------------------------------------------------------- Fenster

    internal static class Windows
    {
        private static readonly string[] SkipClasses = { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow" };

        /// <summary>Sichtbare Hauptfenster in Z-Reihenfolge (vorne zuerst), ohne Werkzeug- und versteckte Fenster.</summary>
        private static List<IntPtr> AppWindows(bool includeMinimized)
        {
            List<IntPtr> list = new List<IntPtr>();
            uint me = (uint)Process.GetCurrentProcess().Id;
            Native.EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                if (!Native.IsWindowVisible(h)) return true;
                if (!includeMinimized && Native.IsIconic(h)) return true;
                if (Native.GetWindow(h, Native.GW_OWNER) != IntPtr.Zero) return true;
                long ex = Native.GetWindowLongPtr(h, Native.GWL_EXSTYLE).ToInt64();
                if ((ex & Native.WS_EX_TOOLWINDOW) != 0) return true;
                int cloaked;
                if (Native.DwmGetWindowAttribute(h, Native.DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
                if (Native.GetWindowTextLength(h) == 0) return true;
                string cls = ClassName(h);
                if (Array.IndexOf(SkipClasses, cls) >= 0) return true;
                uint pid;
                Native.GetWindowThreadProcessId(h, out pid);
                if (pid == me) return true;
                list.Add(h);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        public static IntPtr FindMainWindowOf(string exe)
        {
            foreach (IntPtr h in AppWindows(true))
            {
                string path = ProcessPath(h);
                if (path != null && string.Equals(path, exe, StringComparison.OrdinalIgnoreCase)) return h;
            }
            return IntPtr.Zero;
        }

        /// <summary>
        /// Windows lässt Hintergrundprozesse nur eingeschränkt Fenster nach vorne holen. Ein kurzes Alt-Signal
        /// (keybd_event) hebt die Sperre auf, wie es auch andere Launcher tun.
        /// </summary>
        public static bool BringToFront(IntPtr h)
        {
            if (Native.IsIconic(h)) Native.ShowWindow(h, Native.SW_RESTORE);
            Native.keybd_event(0x12, 0, 0, UIntPtr.Zero);
            Native.keybd_event(0x12, 0, Native.KEYEVENTF_KEYUP, UIntPtr.Zero);
            bool ok = Native.SetForegroundWindow(h);
            Native.BringWindowToTop(h);
            return ok;
        }

        /// <summary>Name der App im Vordergrund, wenn sie mit Administratorrechten läuft (dann blockiert Windows Eingaben).</summary>
        public static string ForegroundElevatedName()
        {
            IntPtr fg = Native.GetForegroundWindow();
            if (fg == IntPtr.Zero) return null;
            uint pid;
            Native.GetWindowThreadProcessId(fg, out pid);
            if (!IsElevated(pid) || IsElevated((uint)Process.GetCurrentProcess().Id)) return null;
            string name = "Das Fenster im Vordergrund";
            try { name = Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
            return name + " läuft als Administrator – Windows lässt keine Eingaben von Copper Deck zu.";
        }

        private static bool IsElevated(uint pid)
        {
            IntPtr proc = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (proc == IntPtr.Zero) return true; // Kein Zugriff: höchstwahrscheinlich erhöht
            try
            {
                IntPtr token;
                if (!Native.OpenProcessToken(proc, Native.TOKEN_QUERY, out token)) return true;
                try
                {
                    int elevation;
                    int len;
                    if (!Native.GetTokenInformation(token, Native.TokenElevation, out elevation, 4, out len)) return false;
                    return elevation != 0;
                }
                finally { Native.CloseHandle(token); }
            }
            finally { Native.CloseHandle(proc); }
        }

        private static string ProcessPath(IntPtr h)
        {
            uint pid;
            Native.GetWindowThreadProcessId(h, out pid);
            IntPtr proc = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (proc == IntPtr.Zero) return null;
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                return Native.QueryFullProcessImageNameW(proc, 0, sb, ref size) ? sb.ToString() : null;
            }
            finally { Native.CloseHandle(proc); }
        }

        private static string ClassName(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(256);
            Native.GetClassNameW(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static string Title(IntPtr h)
        {
            int len = Native.GetWindowTextLength(h);
            StringBuilder sb = new StringBuilder(len + 1);
            Native.GetWindowTextW(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static string AppName(IntPtr h)
        {
            uint pid;
            Native.GetWindowThreadProcessId(h, out pid);
            try
            {
                Process p = Process.GetProcessById((int)pid);
                string desc = null;
                try { desc = p.MainModule.FileVersionInfo.FileDescription; } catch (Exception) { }
                return string.IsNullOrEmpty(desc) ? p.ProcessName : desc;
            }
            catch (Exception) { return "?"; }
        }

        /// <summary>Wie am Mac: 1 = ganzer Bereich, 2 = Hälften, 3 = links gross + rechts zwei, 4 = Raster 2×2.</summary>
        public static int Tile()
        {
            List<IntPtr> all = AppWindows(false);
            List<IntPtr> picked = all.GetRange(0, Math.Min(4, all.Count));
            if (picked.Count == 0)
            {
                Console.Out.WriteLine("{\"ok\":true,\"count\":0,\"windows\":[],\"message\":\"Keine passenden Fenster gefunden.\"}");
                return 0;
            }
            IntPtr mon = Native.MonitorFromWindow(picked[0], Native.MONITOR_DEFAULTTONEAREST);
            Native.MONITORINFO mi = new Native.MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
            Native.GetMonitorInfoW(mon, ref mi);
            Native.RECT a = mi.rcWork;
            int w = a.Right - a.Left, h = a.Bottom - a.Top, hw = w / 2, hh = h / 2;
            List<Native.RECT> targets = new List<Native.RECT>();
            switch (picked.Count)
            {
                case 1: targets.Add(R(a.Left, a.Top, w, h)); break;
                case 2: targets.Add(R(a.Left, a.Top, hw, h)); targets.Add(R(a.Left + hw, a.Top, w - hw, h)); break;
                case 3:
                    targets.Add(R(a.Left, a.Top, hw, h));
                    targets.Add(R(a.Left + hw, a.Top, w - hw, hh));
                    targets.Add(R(a.Left + hw, a.Top + hh, w - hw, h - hh));
                    break;
                default:
                    targets.Add(R(a.Left, a.Top, hw, hh));
                    targets.Add(R(a.Left + hw, a.Top, w - hw, hh));
                    targets.Add(R(a.Left, a.Top + hh, hw, h - hh));
                    targets.Add(R(a.Left + hw, a.Top + hh, w - hw, h - hh));
                    break;
            }
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"count\":" + picked.Count + ",\"windows\":[");
            for (int i = 0; i < picked.Count; i++)
            {
                IntPtr wnd = picked[i];
                Native.RECT t = targets[i];
                string reason = "";
                bool ok = Place(wnd, t, out reason);
                if (i > 0) sb.Append(',');
                sb.Append("{\"app\":").Append(Json.Str(AppName(wnd)))
                  .Append(",\"title\":").Append(Json.Str(Title(wnd)))
                  .Append(",\"ok\":").Append(ok ? "true" : "false")
                  .Append(",\"reason\":").Append(Json.Str(reason)).Append('}');
            }
            sb.Append("]}");
            Console.Out.WriteLine(sb.ToString());
            return 0;
        }

        private static Native.RECT R(int x, int y, int w, int h)
        {
            Native.RECT r;
            r.Left = x; r.Top = y; r.Right = x + w; r.Bottom = y + h;
            return r;
        }

        /// <summary>Setzt die sichtbare Fläche (ohne die unsichtbaren Ränder von Windows 10/11) auf das Ziel.</summary>
        private static bool Place(IntPtr h, Native.RECT target, out string reason)
        {
            reason = "";
            if (Native.IsZoomed(h) || Native.IsIconic(h)) Native.ShowWindow(h, Native.SW_RESTORE);
            Native.RECT win, vis;
            Native.GetWindowRect(h, out win);
            if (Native.DwmGetWindowAttribute(h, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out vis, Marshal.SizeOf(typeof(Native.RECT))) != 0) vis = win;
            int dl = vis.Left - win.Left, dt = vis.Top - win.Top, dr = win.Right - vis.Right, db = win.Bottom - vis.Bottom;
            int x = target.Left - dl, y = target.Top - dt;
            int cw = (target.Right - target.Left) + dl + dr, ch = (target.Bottom - target.Top) + dt + db;
            if (!Native.SetWindowPos(h, IntPtr.Zero, x, y, cw, ch, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE))
            {
                int err = Marshal.GetLastWin32Error();
                reason = err == 5 ? "läuft als Administrator" : "Fenster lässt sich nicht verschieben";
                return false;
            }
            Thread.Sleep(60);
            Native.RECT after;
            if (Native.DwmGetWindowAttribute(h, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out after, Marshal.SizeOf(typeof(Native.RECT))) != 0) Native.GetWindowRect(h, out after);
            const int tol = 12;
            int aw = after.Right - after.Left, ah = after.Bottom - after.Top;
            int tw = target.Right - target.Left, th = target.Bottom - target.Top;
            bool fits = Math.Abs(after.Left - target.Left) <= tol && Math.Abs(after.Top - target.Top) <= tol
                && Math.Abs(aw - tw) <= tol && Math.Abs(ah - th) <= tol;
            if (!fits)
            {
                long style = Native.GetWindowLongPtr(h, Native.GWL_STYLE).ToInt64();
                if ((style & Native.WS_THICKFRAME) == 0) reason = "Grösse nicht änderbar";
                else if (aw > tw + tol || ah > th + tol) reason = "Mindestgrösse zu gross";
                else reason = "App hat die Grösse nicht übernommen";
            }
            return fits;
        }
    }

    // ---------------------------------------------------------------- JSON (minimal, ohne Abhängigkeiten)

    internal static class Json
    {
        public static void Emit(string line)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }

        public static string Obj(params object[] kv)
        {
            StringBuilder sb = new StringBuilder("{");
            for (int i = 0; i + 1 < kv.Length; i += 2)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Str((string)kv[i])).Append(':').Append(Val(kv[i + 1]));
            }
            return sb.Append('}').ToString();
        }

        private static string Val(object v)
        {
            if (v == null) return "null";
            if (v is bool) return (bool)v ? "true" : "false";
            if (v is int) return ((int)v).ToString(CultureInfo.InvariantCulture);
            return Str(v.ToString());
        }

        public static string Str(string s)
        {
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        /// <summary>Liest einen String-Wert aus einfachem JSON (launch.json, von install.ps1 geschrieben).</summary>
        public static string ReadString(string json, string key)
        {
            string needle = "\"" + key + "\"";
            int i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return null;
            i = json.IndexOf(':', i + needle.Length);
            if (i < 0) return null;
            i = json.IndexOf('"', i);
            if (i < 0) return null;
            StringBuilder sb = new StringBuilder();
            for (int j = i + 1; j < json.Length; j++)
            {
                char c = json[j];
                if (c == '"') return sb.ToString();
                if (c == '\\' && j + 1 < json.Length)
                {
                    char n = json[++j];
                    if (n == 'u' && j + 4 < json.Length)
                    {
                        sb.Append((char)int.Parse(json.Substring(j + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        j += 4;
                    }
                    else sb.Append(n == 'n' ? '\n' : n == 't' ? '\t' : n);
                }
                else sb.Append(c);
            }
            return null;
        }
    }

    // ---------------------------------------------------------------- Win32

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage(Native.SIZE size, int flags, out IntPtr phbm);
    }

    internal static class Native
    {
        public const int SIIGBF_BIGGERSIZEOK = 0x1;
        public const int SIIGBF_ICONONLY = 0x4;
        public const uint INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_EXTENDEDKEY = 0x1;
        public const uint KEYEVENTF_KEYUP = 0x2;
        public const uint KEYEVENTF_UNICODE = 0x4;
        public const uint GW_OWNER = 4;
        public const int GWL_STYLE = -16;
        public const int GWL_EXSTYLE = -20;
        public const long WS_EX_TOOLWINDOW = 0x80;
        public const long WS_THICKFRAME = 0x40000;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        public const int DWMWA_CLOAKED = 14;
        public const int SW_RESTORE = 9;
        public const uint SWP_NOZORDER = 0x4;
        public const uint SWP_NOACTIVATE = 0x10;
        public const uint MONITOR_DEFAULTTONEAREST = 2;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public const uint TOKEN_QUERY = 0x8;
        public const int TokenElevation = 20;

        [StructLayout(LayoutKind.Sequential)]
        public struct SIZE { public int cx; public int cy; }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        /// <summary>Union wie in winuser.h; MOUSEINPUT ist das grösste Mitglied und bestimmt die Grösse.</summary>
        [StructLayout(LayoutKind.Explicit)]
        public struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public INPUTUNION u; }

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        public static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);

        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr h);
        [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, Native.INPUT[] inputs, int size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScanW(char c);
        [DllImport("user32.dll")] public static extern uint MapVirtualKeyW(uint code, uint mapType);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr mon, ref MONITORINFO mi);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT value, int size);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr proc, uint flags, StringBuilder sb, ref int size);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int retLen);
    }
}
