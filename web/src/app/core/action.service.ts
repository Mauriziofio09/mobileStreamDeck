import { Injectable, inject } from '@angular/core';
import { ConnectionService, type RunOutcome } from './connection.service';

/** Führt eine Aktion per ID aus (Kachel-, Dock- oder Emoji-ID). Keine Warteschlange. */
@Injectable({ providedIn: 'root' })
export class ActionService {
  private readonly conn = inject(ConnectionService);

  run(actionId: string): Promise<RunOutcome> {
    return this.conn.run(actionId);
  }
}
