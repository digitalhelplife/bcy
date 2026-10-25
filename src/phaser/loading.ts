import Phaser from 'phaser'
/** Progress text + bar while a scene preloads (slow mobile networks would otherwise show a blank canvas). */
export function showLoading(scene: Phaser.Scene, label: string) {
  const { width, height } = scene.scale
  const font = '"ManusCC0 Sans CJK SC", sans-serif'
  const txt = scene.add.text(width / 2, height / 2 - 40, `${label} 0%`, { fontFamily: font, fontSize: '40px', color: '#4A5A3C' }).setOrigin(0.5)
  const barBg = scene.add.rectangle(width / 2, height / 2 + 20, 520, 18, 0xE6DCC6).setOrigin(0.5)
  const bar = scene.add.rectangle(width / 2 - 260, height / 2 + 20, 1, 18, 0x5E8F6E).setOrigin(0, 0.5)
  const onProgress = (v: number) => { txt.setText(`${label} ${Math.round(v * 100)}%`); bar.width = Math.max(1, 520 * v) }
  scene.load.on('progress', onProgress)
  // Detach on first completion: scenes may restart the loader later for on-demand textures (GardenScene.ensure).
  scene.load.once('complete', () => { scene.load.off('progress', onProgress); txt.destroy(); barBg.destroy(); bar.destroy() })
}
