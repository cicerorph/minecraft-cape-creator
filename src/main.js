/**
 * MinecraftCapeCreator
 * - GIF decode:  omggif  (GifReader)
 * - GIF export:  gif.js  (GIF constructor)
 * - ZIP export:  JSZip
 */

class MinecraftCapeCreator {
    constructor() {
        this.canvas = document.createElement('canvas')
        this.context = this.canvas.getContext('2d', { willReadFrequently: true })

        this.AUTO_COLOR = "auto"
        this.color = this.AUTO_COLOR
        this.scale = 1
        this.elytraImage = true

        // GIF animation state
        this._gifFrames = null
        this._gifInfo = null
        this._gifFrameIndex = 0
        this._gifAnimTimer = null
        this._onFrameUpdate = null   // (dataUrl) => void

        // Raw source
        this._imageSrc = null
        this._imageArrayBuffer = null
        this._isGif = false

        // All rendered cape frames — populated by buildCape()
        this._renderedFrames = []    // [{ dataUrl, delay }]

        this.background = null
    }

    // ─── Setters ──────────────────────────────────────────────────────────────

    setColor(color) { this.color = color }
    setAutoColor() { this.color = this.AUTO_COLOR }
    setScale(scale) {
        this.scale = Math.pow(2, Math.max(1, Math.min(scale, 6)) - 1)
    }
    setBackground(background) { this.background = background }
    showOnElytra(value) { this.elytraImage = value }
    onFrameUpdate(cb) { this._onFrameUpdate = cb }
    get isGif() { return this._isGif }
    get frameCount() { return this._renderedFrames ? this._renderedFrames.length : 0 }

    setImage(src) {
        this._stopGifAnimation()
        this._gifFrames = null
        this._gifInfo = null
        this._imageArrayBuffer = null
        this._imageSrc = null
        this._isGif = false
        this._renderedFrames = []

        if (src && src.startsWith('data:image/gif')) {
            this._isGif = true
            const base64 = src.split(',')[1]
            const binary = atob(base64)
            const buf = new ArrayBuffer(binary.length)
            const bytes = new Uint8Array(buf)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            this._imageArrayBuffer = buf
        } else {
            this._imageSrc = src
        }
    }

    // ─── Build ────────────────────────────────────────────────────────────────

    buildCape() {
        this._stopGifAnimation()

        if (this._isGif && this._imageArrayBuffer) {
            return this._decodeGif(this._imageArrayBuffer)
                .then(({ frames, info }) => {
                    this._gifFrames = frames
                    this._gifInfo = info
                    this._gifFrameIndex = 0
                    return this._renderAllGifFrames()
                })
                .then(() => {
                    const first = this._renderedFrames[0]
                    this._startGifAnimation()
                    return first ? first.dataUrl : null
                })
        } else {
            this._renderedFrames = []
            return this._buildStaticCape(this._imageSrc).then(dataUrl => {
                this._renderedFrames = [{ dataUrl, delay: 100 }]
                return dataUrl
            })
        }
    }

    // ─── GIF decode via omggif ────────────────────────────────────────────────

    _decodeGif(arrayBuffer) {
        return new Promise((resolve, reject) => {
            try {
                const gr = new GifReader(new Uint8Array(arrayBuffer))
                const info = { width: gr.width, height: gr.height }
                const frames = []

                // Persistent composite canvas — never fully cleared between frames
                const comp = document.createElement('canvas')
                comp.width  = info.width
                comp.height = info.height
                const compCtx = comp.getContext('2d')

                let prevSnapshot = null

                for (let i = 0; i < gr.numFrames(); i++) {
                    const fi = gr.frameInfo(i)
                    const px = fi.x      || 0
                    const py = fi.y      || 0
                    const pw = fi.width
                    const ph = fi.height

                    // ── Disposal of the PREVIOUS frame ──────────────────────
                    if (i > 0) {
                        const prev = frames[i - 1]
                        if (prev.disposal === 2) {
                            // Restore to background colour (transparent)
                            compCtx.clearRect(prev.x, prev.y, prev.pw, prev.ph)
                        } else if (prev.disposal === 3 && prevSnapshot) {
                            // Restore to what was there before previous frame
                            compCtx.putImageData(prevSnapshot, 0, 0)
                        }
                        // disposal 0 or 1 → leave composite as-is (do nothing)
                    }

                    // Save snapshot BEFORE drawing current frame (needed if disposal=3)
                    if (fi.disposal === 3) {
                        prevSnapshot = compCtx.getImageData(0, 0, info.width, info.height)
                    }

                    // ── Decode only the patch pixels (pw × ph) ──────────────
                    // decodeAndBlitFrameRGBA always writes into a full-canvas-sized
                    // buffer, but only the patch region (x,y,w,h) has real data.
                    // We extract just that rectangle and putImageData with offset
                    // so the rest of the composite is untouched.
                    const fullPixels = new Uint8ClampedArray(info.width * info.height * 4)
                    gr.decodeAndBlitFrameRGBA(i, fullPixels)

                    // Extract patch rows from the full buffer
                    const patchPixels = new Uint8ClampedArray(pw * ph * 4)
                    for (let row = 0; row < ph; row++) {
                        const srcOffset  = ((py + row) * info.width + px) * 4
                        const destOffset = row * pw * 4
                        patchPixels.set(fullPixels.subarray(srcOffset, srcOffset + pw * 4), destOffset)
                    }

                    // Blit patch at its correct offset — leaves everything else intact
                    compCtx.putImageData(new ImageData(patchPixels, pw, ph), px, py)

                    // ── Snapshot the fully composited frame ──────────────────
                    const snap = document.createElement('canvas')
                    snap.width  = info.width
                    snap.height = info.height
                    snap.getContext('2d').drawImage(comp, 0, 0)

                    frames.push({
                        canvas:   snap,
                        delay:    (fi.delay || 10) * 10,
                        x: px, y: py, pw, ph,
                        disposal: fi.disposal || 0
                    })
                }

                resolve({ frames, info })
            } catch (e) {
                reject(e)
            }
        })
    }

    // ─── Render every GIF frame into a cape PNG ───────────────────────────────

    async _renderAllGifFrames() {
        this._renderedFrames = []
        for (const frame of this._gifFrames) {
            const dataUrl = await this._buildStaticCape(frame.canvas.toDataURL())
            this._renderedFrames.push({ dataUrl, delay: frame.delay })
        }
    }

    // ─── Animation loop ───────────────────────────────────────────────────────

    _startGifAnimation() {
        if (!this._renderedFrames || this._renderedFrames.length <= 1) return
        const tick = () => {
            const frame = this._renderedFrames[this._gifFrameIndex]
            if (this._onFrameUpdate && frame) this._onFrameUpdate(frame.dataUrl)
            this._gifFrameIndex = (this._gifFrameIndex + 1) % this._renderedFrames.length
            const next = this._renderedFrames[this._gifFrameIndex]
            this._gifAnimTimer = setTimeout(tick, next ? next.delay : 100)
        }
        const first = this._renderedFrames[0]
        this._gifAnimTimer = setTimeout(tick, first ? first.delay : 100)
    }

    _stopGifAnimation() {
        if (this._gifAnimTimer) { clearTimeout(this._gifAnimTimer); this._gifAnimTimer = null }
    }

    // ─── Core cape render ─────────────────────────────────────────────────────

    _buildStaticCape(imageSrc) {
        return new Promise(async (resolve, reject) => {
            try {
                const s = this.scale

                // Fresh canvas per call — prevents GIF frames from bleeding into each other
                const offscreen = document.createElement('canvas')
                offscreen.width  = 64 * s
                offscreen.height = 32 * s
                const ctx = offscreen.getContext('2d', { willReadFrequently: true })
                // No need to clearRect — brand-new canvas is already transparent

                const avgColor = (imgData) => {
                    const d = imgData.data
                    let r = 0, g = 0, b = 0, n = 0
                    for (let i = 0; i < d.length; i += 20) { r += d[i]; g += d[i+1]; b += d[i+2]; n++ }
                    return `#${((1<<24)|(Math.floor(r/n)<<16)|(Math.floor(g/n)<<8)|Math.floor(b/n)).toString(16).slice(1)}`
                }

                const fr = (x,y,w,h) => ctx.fillRect(x*s,y*s,w*s,h*s)
                const cr = (x,y,w,h) => ctx.clearRect(x*s,y*s,w*s,h*s)

                const loadImg = (src) => new Promise((res, rej) => {
                    if (src instanceof HTMLCanvasElement) { res(src); return }
                    const i = new Image(); i.crossOrigin = "anonymous"
                    i.onload = () => res(i); i.onerror = rej; i.src = src
                })

                let bgImg = null, fgImg = null
                const tasks = []
                if (this.background) tasks.push(loadImg(this.background).then(i => bgImg = i))
                if (imageSrc)        tasks.push(loadImg(imageSrc).then(i => fgImg = i))
                await Promise.all(tasks)

                if (bgImg) {
                    ctx.imageSmoothingEnabled = false
                    ctx.drawImage(bgImg, 0, 0, bgImg.width, bgImg.height, 0, 0, offscreen.width, offscreen.height)
                }

                if (fgImg) {
                    ctx.drawImage(fgImg, 1*s, 1*s, 10*s, 16*s)
                    ctx.fillStyle = this.color === this.AUTO_COLOR
                        ? avgColor(ctx.getImageData(1*s, 1*s, 10*s, 16*s))
                        : this.color

                    if (this.elytraImage) {
                        ctx.drawImage(fgImg, 36*s, 2*s, 10*s, 20*s)
                    } else if (!this.background) {
                        fr(36,2,10,20)
                    }

                    if (!this.background) {
                        fr(0,1,1,16);  fr(1,0,10,1);  fr(11,1,1,16); fr(11,0,10,1)
                        fr(12,1,10,16);fr(22,11,1,11);fr(31,0,3,1);  fr(32,1,2,1)
                        fr(34,0,6,1);  fr(34,2,1,2);  fr(35,2,1,9)
                    }

                    if (!this.background || (this.background && this.elytraImage)) {
                        cr(36,16,1,6); cr(37,19,1,3); cr(38,21,1,1)
                        cr(42,2,1,1);  cr(43,2,1,2);  cr(44,2,1,5);  cr(45,2,1,9)
                    }
                }

                // Mirror to shared canvas so downloadCape() always has the latest frame
                this.canvas.width  = offscreen.width
                this.canvas.height = offscreen.height
                this.context.drawImage(offscreen, 0, 0)

                resolve(offscreen.toDataURL())
            } catch (err) {
                reject(err)
            }
        })
    }

    // ─── Export: PNG (current frame) ──────────────────────────────────────────

    downloadCape(name = "Cape") {
        const link = document.createElement('a')
        link.download = `${name}.png`
        link.href = this.context.canvas.toDataURL("image/png").replace("image/png", "image/octet-stream")
        link.click()
    }

    // ─── Export: Animated GIF via gif.js ──────────────────────────────────────

    exportGif(name = "Cape") {
        return new Promise((resolve, reject) => {
            if (!this._renderedFrames?.length) { reject(new Error("No frames")); return }
            if (typeof GIF === 'undefined') { reject(new Error("gif.js not loaded")); return }

            const CORS_PROXY = 'https://cors-proxy-mubi.ciceroraphael-turmaprealfa.workers.dev/cors?target='
            const workerUrl = `${CORS_PROXY}${encodeURIComponent('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js')}`

            const gif = new GIF({
                workers: 2,
                quality: 10,
                width:  64 * this.scale,
                height: 32 * this.scale,
                workerScript: workerUrl
            })

            // Convert each rendered frame dataUrl → canvas so gif.js reads
            // the already-composited cape pixels, not the original image.
            const dataUrlToCanvas = (dataUrl) => new Promise((res, rej) => {
                const img = new Image()
                img.onload = () => {
                    const c = document.createElement('canvas')
                    c.width = img.naturalWidth
                    c.height = img.naturalHeight
                    c.getContext('2d').drawImage(img, 0, 0)
                    res(c)
                }
                img.onerror = rej
                img.src = dataUrl
            })

            Promise.all(this._renderedFrames.map(f => dataUrlToCanvas(f.dataUrl))).then(canvases => {
                canvases.forEach((canvas, i) => {
                    gif.addFrame(canvas, {
                        delay: this._renderedFrames[i].delay,
                        copy: true   // gif.js must copy pixels before we reuse the canvas
                    })
                })
                gif.on('finished', blob => {
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url; link.download = `${name}.gif`; link.click()
                    setTimeout(() => URL.revokeObjectURL(url), 5000)
                    resolve()
                })
                gif.on('error', reject)
                gif.render()
            }).catch(reject)
        })
    }

    // ─── Export: ZIP of PNG frames via JSZip ─────────────────────────────────

    exportFramesZip(name = "Cape") {
        return new Promise((resolve, reject) => {
            if (!this._renderedFrames?.length) { reject(new Error("No frames")); return }
            if (typeof JSZip === 'undefined') { reject(new Error("JSZip not loaded")); return }

            const zip = new JSZip()
            const folder = zip.folder(name)
            const pad = (n) => String(n).padStart(String(this._renderedFrames.length).length, '0')

            this._renderedFrames.forEach((frame, i) => {
                folder.file(`frame_${pad(i + 1)}.png`, frame.dataUrl.split(',')[1], { base64: true })
            })

            zip.generateAsync({ type: 'blob' }).then(blob => {
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url; link.download = `${name}_frames.zip`; link.click()
                setTimeout(() => URL.revokeObjectURL(url), 5000)
                resolve()
            }).catch(reject)
        })
    }
}

window.MinecraftCapeCreator = MinecraftCapeCreator
export default MinecraftCapeCreator
