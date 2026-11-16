/**
 * Lightroom Classic: feste Liste steuerbarer Entwicklungsregler und Befehle.
 * Die Namen sind die Entwicklungsparameter des Lightroom-SDK (LrDevelopController).
 * Plugin, Helper und App erlauben nur diese Werte.
 */

export type LrPanel = 'basic' | 'curve' | 'hsl' | 'grading' | 'detail' | 'effects';

export interface LrParamDef {
  readonly id: string;
  readonly label: string;
  readonly panel: LrPanel;
  /** Untergruppe im Panel (z. B. "Ton", "Präsenz", HSL-Kanal). */
  readonly group: string;
  /** Standardbereich; das Plugin meldet für das aktuelle Foto den echten Bereich (z. B. Temperatur bei Raw). */
  readonly min: number;
  readonly max: number;
  readonly decimals: number;
  /** Farbe der Reglerspur (HSL, Temperatur, Tönung). */
  readonly track?: string;
}

const p = (id: string, label: string, panel: LrPanel, group: string, min: number, max: number, decimals = 0, track?: string): LrParamDef =>
  track ? { id, label, panel, group, min, max, decimals, track } : { id, label, panel, group, min, max, decimals };

export const HSL_COLORS = [
  ['Red', 'Rot', '#e5484d'], ['Orange', 'Orange', '#f2862b'], ['Yellow', 'Gelb', '#e9c53a'], ['Green', 'Grün', '#46a758'],
  ['Aqua', 'Aquamarin', '#3fb6c4'], ['Blue', 'Blau', '#3e63dd'], ['Purple', 'Lila', '#8e4ec6'], ['Magenta', 'Magenta', '#d6409f'],
] as const;

export const LR_PARAMS: readonly LrParamDef[] = [
  p('Temperature', 'Temperatur', 'basic', 'Weissabgleich', -100, 100, 0, 'linear-gradient(90deg,#3e7bdc,#e8d27a)'),
  p('Tint', 'Tönung', 'basic', 'Weissabgleich', -150, 150, 0, 'linear-gradient(90deg,#46a758,#c04fb6)'),
  p('Exposure2012', 'Belichtung', 'basic', 'Ton', -5, 5, 2),
  p('Contrast2012', 'Kontrast', 'basic', 'Ton', -100, 100),
  p('Highlights2012', 'Lichter', 'basic', 'Ton', -100, 100),
  p('Shadows2012', 'Tiefen', 'basic', 'Ton', -100, 100),
  p('Whites2012', 'Weiss', 'basic', 'Ton', -100, 100),
  p('Blacks2012', 'Schwarz', 'basic', 'Ton', -100, 100),
  p('Texture', 'Struktur', 'basic', 'Präsenz', -100, 100),
  p('Clarity2012', 'Klarheit', 'basic', 'Präsenz', -100, 100),
  p('Dehaze', 'Dunst entfernen', 'basic', 'Präsenz', -100, 100),
  p('Vibrance', 'Dynamik', 'basic', 'Präsenz', -100, 100),
  p('Saturation', 'Sättigung', 'basic', 'Präsenz', -100, 100),

  p('ParametricHighlights', 'Lichter', 'curve', 'Gradationskurve', -100, 100),
  p('ParametricLights', 'Helle Mitteltöne', 'curve', 'Gradationskurve', -100, 100),
  p('ParametricDarks', 'Dunkle Mitteltöne', 'curve', 'Gradationskurve', -100, 100),
  p('ParametricShadows', 'Tiefen', 'curve', 'Gradationskurve', -100, 100),

  ...HSL_COLORS.flatMap(([en, de, color]) => [
    p(`HueAdjustment${en}`, de, 'hsl', 'Farbton', -100, 100, 0, color),
    p(`SaturationAdjustment${en}`, de, 'hsl', 'Sättigung', -100, 100, 0, color),
    p(`LuminanceAdjustment${en}`, de, 'hsl', 'Luminanz', -100, 100, 0, color),
  ]),

  p('SplitToningShadowHue', 'Farbton', 'grading', 'Tiefen', 0, 359, 0, 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)'),
  p('SplitToningShadowSaturation', 'Sättigung', 'grading', 'Tiefen', 0, 100),
  p('ColorGradeShadowLum', 'Luminanz', 'grading', 'Tiefen', -100, 100),
  p('ColorGradeMidtoneHue', 'Farbton', 'grading', 'Mitteltöne', 0, 359, 0, 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)'),
  p('ColorGradeMidtoneSat', 'Sättigung', 'grading', 'Mitteltöne', 0, 100),
  p('ColorGradeMidtoneLum', 'Luminanz', 'grading', 'Mitteltöne', -100, 100),
  p('SplitToningHighlightHue', 'Farbton', 'grading', 'Lichter', 0, 359, 0, 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)'),
  p('SplitToningHighlightSaturation', 'Sättigung', 'grading', 'Lichter', 0, 100),
  p('ColorGradeHighlightLum', 'Luminanz', 'grading', 'Lichter', -100, 100),
  p('ColorGradeBlending', 'Überblendung', 'grading', 'Global', 0, 100),
  p('SplitToningBalance', 'Abgleich', 'grading', 'Global', -100, 100),

  p('Sharpness', 'Betrag', 'detail', 'Schärfen', 0, 150),
  p('SharpenRadius', 'Radius', 'detail', 'Schärfen', 0.5, 3, 1),
  p('SharpenDetail', 'Details', 'detail', 'Schärfen', 0, 100),
  p('SharpenEdgeMasking', 'Maskieren', 'detail', 'Schärfen', 0, 100),
  p('LuminanceSmoothing', 'Luminanz', 'detail', 'Rauschreduzierung', 0, 100),
  p('ColorNoiseReduction', 'Farbe', 'detail', 'Rauschreduzierung', 0, 100),

  p('PostCropVignetteAmount', 'Betrag', 'effects', 'Vignettierung', -100, 100),
  p('PostCropVignetteMidpoint', 'Mittelpunkt', 'effects', 'Vignettierung', 0, 100),
  p('PostCropVignetteFeather', 'Weiche Kante', 'effects', 'Vignettierung', 0, 100),
  p('GrainAmount', 'Stärke', 'effects', 'Körnung', 0, 100),
  p('GrainSize', 'Grösse', 'effects', 'Körnung', 0, 100),
  p('GrainFrequency', 'Unregelmässigkeit', 'effects', 'Körnung', 0, 100),
];

export const LR_PARAM_IDS: readonly string[] = LR_PARAMS.map((x) => x.id);

export type LrFlag = 'pick' | 'reject' | 'none';
export type LrLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'none';
export type LrTool = 'loupe' | 'crop' | 'dust' | 'redeye' | 'masking';

/** Befehle vom Gerät (geprüft im Helper, nochmals im Plugin). */
export type LrCommand =
  | { readonly cmd: 'set'; readonly param: string; readonly value: number }
  | { readonly cmd: 'inc' | 'dec' | 'reset'; readonly param: string }
  | { readonly cmd: 'rating'; readonly value: 0 | 1 | 2 | 3 | 4 | 5 }
  | { readonly cmd: 'flag'; readonly value: LrFlag }
  | { readonly cmd: 'label'; readonly value: LrLabel }
  | { readonly cmd: 'nav'; readonly value: 'next' | 'prev' }
  | { readonly cmd: 'module'; readonly value: 'library' | 'develop' }
  | { readonly cmd: 'tool'; readonly value: LrTool }
  | { readonly cmd: 'auto'; readonly value: 'tone' | 'wb' }
  | { readonly cmd: 'preset'; readonly id: string }
  | { readonly cmd: 'copy' | 'paste' | 'undo' | 'redo' | 'beforeafter' | 'resetall' | 'presets' | 'export' };

export interface LrPhoto {
  readonly name: string;
  readonly rating: number;
  readonly flag: LrFlag;
  readonly label: LrLabel;
  /** Position in der Auswahl/Filmstreifen, falls bekannt. */
  readonly index?: number;
  readonly count?: number;
}

export interface LrPresetFolder {
  readonly name: string;
  readonly presets: readonly { readonly id: string; readonly name: string }[];
}

/** Zustand, den der Helper an alle Geräte verteilt. */
export interface LrState {
  /** Plugin verbunden (Lightroom Classic läuft mit dem Copper-Deck-Plugin). */
  readonly connected: boolean;
  readonly module: string | null;
  readonly photo: LrPhoto | null;
  readonly values: Readonly<Record<string, number>>;
  /** Echte Bereiche für das aktuelle Foto (nur, wo sie vom Standard abweichen). */
  readonly ranges: Readonly<Record<string, readonly [number, number]>>;
  readonly beforeAfter: boolean;
  readonly lrVersion: string | null;
}

export const LR_EMPTY_STATE: LrState = {
  connected: false, module: null, photo: null, values: {}, ranges: {}, beforeAfter: false, lrVersion: null,
};

/** Lokale Ports des Plugins (nur 127.0.0.1). Das Plugin empfängt auf dem ersten und sendet auf dem zweiten. */
export const LR_PORTS = { toPlugin: 47801, fromPlugin: 47802 } as const;
