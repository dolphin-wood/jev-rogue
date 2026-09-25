import Phaser from "phaser";
import { preloadSfx } from "../audio.ts";
import { fontFamily, getLang, loadFont, t } from "../i18n/index.ts";
import { preloadHallArt } from "./hall-art.ts";

/** A visible first frame while the atlas, hall art, effects and font load. */
export class BootScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Graphics;
  private wordmark!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private count!: Phaser.GameObjects.Text;
  private logo: Phaser.GameObjects.Image | null = null;
  private progress = 0;
  private assetsReady = false;
  private fontReady = false;
  private failedFile: string | null = null;

  constructor() {
    super("boot");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0d0b1f");
    this.bar = this.add.graphics();
    this.wordmark = this.add.text(0, 0, "JEV ROGUE", {
      fontFamily: "monospace", fontSize: "26px", color: "#e5d7a7",
    }).setOrigin(0.5);
    this.status = this.add.text(0, 0, t("boot.loading"), {
      fontFamily: fontFamily(), fontSize: "12px", color: "#b0a9bd", align: "center",
    }).setOrigin(0.5, 0);
    this.count = this.add.text(0, 0, "0%", {
      fontFamily: fontFamily(), fontSize: "12px", color: "#e5d7a7",
    }).setOrigin(0.5);
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    // Font loading used to hold up Phaser itself. Here it runs alongside the
    // asset queue, with the splash already on screen.
    void loadFont(getLang()).then(() => {
      this.fontReady = true;
      this.status.setText(this.status.text);
      this.count.setText(this.count.text);
      this.enterPlayWhenReady();
    });

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      this.progress = value;
      this.count.setText(`${Math.round(value * 100)}%`);
      this.drawBar();
    });
    this.load.on(Phaser.Loader.Events.FILE_PROGRESS, (file: Phaser.Loader.File) => {
      this.showFile(file);
    });
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
      if (key !== "gameLogo") return;
      this.logo = this.add.image(0, 145, "gameLogo").setDisplaySize(360, 183);
      this.wordmark.setVisible(false);
      this.layout();
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failedFile ??= this.fileName(file);
      this.status.setText(t("boot.failed", { file: this.failedFile }));
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.assetsReady = true;
      if (!this.failedFile) this.status.setText(t("boot.preparing"));
      this.enterPlayWhenReady();
    });

    this.load.image("gameLogo", "logo.png");
    this.load.image("sheet", "sprites.png");
    this.load.json("atlasJson", "sprites.json");
    preloadHallArt(this);
    preloadSfx(this);
    this.load.start();
  }

  private fileName(file: Phaser.Loader.File): string {
    const url = typeof file.url === "string" ? file.url : file.key;
    return url.split("/").pop() ?? file.key;
  }

  private showFile(file: Phaser.Loader.File): void {
    if (!this.failedFile) this.status.setText(`${t("boot.loading")}  ${this.fileName(file)}`);
  }

  private enterPlayWhenReady(): void {
    if (this.assetsReady && this.fontReady && !this.failedFile) this.scene.start("play");
  }

  private layout(): void {
    const zoom = this.scale.height / 416;
    const centre = this.scale.width / zoom / 2;
    this.cameras.main.setZoom(zoom).centerOn(centre, 208);
    this.wordmark.setPosition(centre, 145);
    this.logo?.setPosition(centre, 145);
    this.status.setPosition(centre, 327);
    this.count.setPosition(centre, 310);
    this.drawBar();
  }

  private drawBar(): void {
    const centre = this.scale.width / (this.scale.height / 416) / 2;
    const left = centre - 164;
    this.bar.clear();
    this.bar.fillStyle(0x161334).fillRect(left - 4, 279, 328, 21);
    this.bar.lineStyle(2, 0x6a668a).strokeRect(left - 4, 279, 328, 21);
    this.bar.fillStyle(0x302d48).fillRect(left, 283, 320, 13);
    this.bar.fillStyle(0xd0b874);
    for (let segment = 0; segment < Math.floor(this.progress * 32); segment++)
      this.bar.fillRect(left + segment * 10, 283, 8, 13);
  }
}
