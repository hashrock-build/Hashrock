// Live character preview: a tiny Pixi app rendering the current body (idle) + outfit tint
// + held axe, shown inside the Profile / Marketplace cards. Reuses the Player class so the
// preview matches exactly what you see in-game. One instance is moved into the open card.
import { Application, Sprite, Texture, Assets } from "pixi.js";
import { Player, PlayerAnims } from "./player";
import { SKINS } from "../shared/items";

export class CharacterPreview {
  private app: Application;
  private player?: Player;
  private axe?: Sprite;
  ready: Promise<void>;

  constructor(chars: PlayerAnims[], size = 120) {
    this.app = new Application();
    this.ready = this.app.init({ width: size, height: size, backgroundAlpha: 0, antialias: false }).then(() => {
      this.player = new Player(chars, 2.4, 0);
      this.player.sprite.x = size * 0.46;
      this.player.sprite.y = size * 0.92;
      this.player.update("down", false, false); // idle, facing camera
      this.axe = new Sprite();
      this.axe.anchor.set(0.5, 1);
      this.axe.x = size * 0.74; this.axe.y = size * 0.66; this.axe.scale.set(1.5); this.axe.angle = 22;
      this.app.stage.addChild(this.player.sprite, this.axe);
    });
  }

  get canvas(): HTMLCanvasElement { return this.app.canvas as HTMLCanvasElement; }

  set(body: number, skin: number, axe: number): void {
    if (!this.player) return;
    this.player.setBody(body);
    this.player.update("down", false, false);
    this.player.sprite.tint = SKINS[skin]?.color ?? 0xffffff;
    Assets.load(`/assets/axes/axe_${axe}.png`).then((t: Texture) => { if (this.axe) this.axe.texture = t; });
  }
}
