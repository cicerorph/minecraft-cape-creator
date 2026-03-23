/**
 * MinecraftCapeCreator
 * - GIF decode:  omggif (GifReader) — parse manual correto frame a frame
 * - GIF export:  gif.js + allorigins CORS proxy
 * - ZIP export:  JSZip
 */

class MinecraftCapeCreator {
    constructor() {
        this.canvas  = document.createElement('canvas')
        this.context = this.canvas.getContext('2d', { willReadFrequently: true })

        this.AUTO_COLOR  = 'auto'
        this.color       = this.AUTO_COLOR
        this.scale       = 1
        this.elytraImage = true

        this._gifFrameIndex = 0
        this._gifAnimTimer  = null
        this._onFrameUpdate = null  // (dataUrl) => void

        this._imageSrc   = null
        this._isGif      = false
        this._gifBytes   = null     // Uint8Array

        this._renderedFrames = []   // [{ dataUrl, delay }]
        this.background = null
    }

    // ─── Setters ──────────────────────────────────────────────────────────────

    setColor(color)   { this.color = color }
    setAutoColor()    { this.color = this.AUTO_COLOR }
    setScale(scale)   { this.scale = Math.pow(2, Math.max(1, Math.min(scale, 6)) - 1) }
    setBackground(b)  { this.background = b }
    showOnElytra(v)   { this.elytraImage = v }
    onFrameUpdate(cb) { this._onFrameUpdate = cb }
    get isGif()       { return this._isGif }
    get frameCount()  { return this._renderedFrames?.length ?? 0 }

    setImage(src) {
        this._stopGifAnimation()
        this._imageSrc = null
        this._gifBytes = null
        this._isGif    = false
        this._renderedFrames = []

        if (src?.startsWith('data:image/gif')) {
            this._isGif = true
            const b64    = src.split(',')[1]
            const bin    = atob(b64)
            const bytes  = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            this._gifBytes = bytes
        } else {
            this._imageSrc = src
        }
    }

    // ─── Build ────────────────────────────────────────────────────────────────

    buildCape() {
        this._stopGifAnimation()

        if (this._isGif && this._gifBytes) {
            return this._decodeGif(this._gifBytes)
                .then(frames => this._renderAllGifFrames(frames))
                .then(() => {
                    this._gifFrameIndex = 0
                    this._startGifAnimation()
                    return this._renderedFrames[0]?.dataUrl ?? null
                })
        }

        this._renderedFrames = []
        return this._buildStaticCape(this._imageSrc).then(dataUrl => {
            this._renderedFrames = [{ dataUrl, delay: 100 }]
            return dataUrl
        })
    }

    // ─── GIF decode via omggif ────────────────────────────────────────────────
    // Usa GifReader.decodeAndBlitFrameRGBA com tamanho total do canvas,
    // mas extrai apenas o patch do frame usando offsets calculados manualmente,
    // e compõe num canvas persistente aplicando as disposal rules corretamente.

    _decodeGif(bytes) {
        return new Promise((resolve, reject) => {
            try {
                const gr     = new GifReader(bytes)
                const W      = gr.width
                const H      = gr.height
                const nFrames = gr.numFrames()
                const frames  = []

                const comp    = document.createElement('canvas')
                comp.width    = W
                comp.height   = H
                const compCtx = comp.getContext('2d')

                const buf = new Uint8ClampedArray(W * H * 4)

                let prevRestoreData = null

                for (let f = 0; f < nFrames; f++) {
                    const fi  = gr.frameInfo(f)
                    const fx  = fi.x
                    const fy  = fi.y
                    const fw  = fi.width
                    const fh  = fi.height
                    const dis = fi.disposal ?? 0

                    // ── 1. Apply disposal of PREVIOUS frame ─────────────────────
                    if (f > 0) {
                        const pf = frames[f - 1]
                        if (pf.disposal === 2) {
                            compCtx.clearRect(pf.fx, pf.fy, pf.fw, pf.fh)
                        } else if (pf.disposal === 3 && prevRestoreData) {
                            compCtx.putImageData(prevRestoreData, 0, 0)
                        }
                    }

                    // ── 2. Save snapshot BEFORE drawing (for disposal=3) ────────
                    if (dis === 3) {
                        prevRestoreData = compCtx.getImageData(0, 0, W, H)
                    }

                    // ── 3. Decode pixels into full-canvas buffer ─────────────────
                    buf.fill(0)
                    gr.decodeAndBlitFrameRGBA(f, buf)

                    // ── 4. Extract patch pixels from buffer ──────────────────────
                    const patch = new Uint8ClampedArray(fw * fh * 4)
                    for (let row = 0; row < fh; row++) {
                        const srcOff = ((fy + row) * W + fx) * 4
                        const dstOff = row * fw * 4
                        patch.set(buf.subarray(srcOff, srcOff + fw * 4), dstOff)
                    }

                    // ── 5. Merge patch into composite (skip transparent pixels) ──
                    const existingData = compCtx.getImageData(fx, fy, fw, fh)
                    for (let i = 0; i < patch.length; i += 4) {
                        if (patch[i + 3] > 0) {
                            existingData.data[i]     = patch[i]
                            existingData.data[i + 1] = patch[i + 1]
                            existingData.data[i + 2] = patch[i + 2]
                            existingData.data[i + 3] = patch[i + 3]
                        }
                    }
                    compCtx.putImageData(existingData, fx, fy)

                    // ── 6. Snapshot full composite for this frame ────────────────
                    const snap = document.createElement('canvas')
                    snap.width  = W
                    snap.height = H
                    snap.getContext('2d').drawImage(comp, 0, 0)

                    frames.push({
                        canvas:   snap,
                        delay:    Math.max((fi.delay || 10) * 10, 20),
                        fx, fy, fw, fh,
                        disposal: dis
                    })
                }

                resolve(frames)
            } catch (e) {
                reject(e)
            }
        })
    }

    // ─── Render frames → capes ────────────────────────────────────────────────

    async _renderAllGifFrames(frames) {
        this._renderedFrames = []
        for (const frame of frames) {
            const dataUrl = await this._buildStaticCape(frame.canvas)
            this._renderedFrames.push({ dataUrl, delay: frame.delay })
        }
    }

    // ─── Animation loop ───────────────────────────────────────────────────────

    _startGifAnimation() {
        if (this._renderedFrames.length <= 1) return
        const tick = () => {
            const frame = this._renderedFrames[this._gifFrameIndex]
            if (this._onFrameUpdate && frame) this._onFrameUpdate(frame.dataUrl)
            this._gifFrameIndex = (this._gifFrameIndex + 1) % this._renderedFrames.length
            const next = this._renderedFrames[this._gifFrameIndex]
            this._gifAnimTimer = setTimeout(tick, next?.delay ?? 100)
        }
        this._gifAnimTimer = setTimeout(tick, this._renderedFrames[0]?.delay ?? 100)
    }

    _stopGifAnimation() {
        if (this._gifAnimTimer) { clearTimeout(this._gifAnimTimer); this._gifAnimTimer = null }
    }

    // ─── Core cape render — canvas novo por frame ─────────────────────────────

    _buildStaticCape(imageSrc) {
        return new Promise(async (resolve, reject) => {
            try {
                const s = this.scale

                const offscreen    = document.createElement('canvas')
                offscreen.width    = 64 * s
                offscreen.height   = 32 * s
                const ctx = offscreen.getContext('2d', { willReadFrequently: true })

                const avgColor = (imgData) => {
                    const d = imgData.data
                    let r = 0, g = 0, b = 0, n = 0
                    for (let i = 0; i < d.length; i += 20) { r += d[i]; g += d[i+1]; b += d[i+2]; n++ }
                    return `#${((1<<24)|(Math.floor(r/n)<<16)|(Math.floor(g/n)<<8)|Math.floor(b/n)).toString(16).slice(1)}`
                }

                const fr = (x,y,w,h) => ctx.fillRect(x*s, y*s, w*s, h*s)
                const cr = (x,y,w,h) => ctx.clearRect(x*s, y*s, w*s, h*s)

                const loadImg = (src) => new Promise((res, rej) => {
                    if (src instanceof HTMLCanvasElement) { res(src); return }
                    const img = new Image()
                    img.crossOrigin = 'anonymous'
                    img.onload  = () => res(img)
                    img.onerror = rej
                    img.src = src
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
                        fr(36, 2, 10, 20)
                    }

                    if (!this.background) {
                        fr(0,1,1,16);   fr(1,0,10,1);   fr(11,1,1,16);  fr(11,0,10,1)
                        fr(12,1,10,16); fr(22,11,1,11); fr(31,0,3,1);   fr(32,1,2,1)
                        fr(34,0,6,1);   fr(34,2,1,2);   fr(35,2,1,9)
                    }

                    if (!this.background || (this.background && this.elytraImage)) {
                        cr(36,16,1,6); cr(37,19,1,3); cr(38,21,1,1)
                        cr(42,2,1,1);  cr(43,2,1,2);  cr(44,2,1,5);  cr(45,2,1,9)
                    }
                }

                this.canvas.width  = offscreen.width
                this.canvas.height = offscreen.height
                this.context.drawImage(offscreen, 0, 0)

                resolve(offscreen.toDataURL())
            } catch (err) {
                reject(err)
            }
        })
    }

    // ─── Export: PNG ──────────────────────────────────────────────────────────

    downloadCape(name = 'Cape') {
        const link = document.createElement('a')
        link.download = `${name}.png`
        link.href = this.context.canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream')
        link.click()
    }

    // ─── Export: GIF ──────────────────────────────────────────────────────────

    exportGif(name = 'Cape') {
        return new Promise((resolve, reject) => {
            if (!this._renderedFrames?.length) { reject(new Error('No frames')); return }
            if (typeof GIF === 'undefined')    { reject(new Error('gif.js not loaded')); return }

            const workerSrc = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js'
            const workerUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(workerSrc)}`

            const gif = new GIF({
                workers:      2,
                quality:      10,
                width:        64 * this.scale,
                height:       32 * this.scale,
                workerScript: workerUrl
            })

            const dataUrlToCanvas = (dataUrl) => new Promise((res, rej) => {
                const img = new Image()
                img.onload = () => {
                    const c = document.createElement('canvas')
                    c.width  = img.naturalWidth
                    c.height = img.naturalHeight
                    c.getContext('2d').drawImage(img, 0, 0)
                    res(c)
                }
                img.onerror = rej
                img.src = dataUrl
            })

            Promise.all(this._renderedFrames.map(f => dataUrlToCanvas(f.dataUrl))).then(canvases => {
                canvases.forEach((canvas, i) => {
                    gif.addFrame(canvas, { delay: this._renderedFrames[i].delay, copy: true })
                })
                gif.on('finished', blob => {
                    const url  = URL.createObjectURL(blob)
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

    // ─── Export: ZIP ──────────────────────────────────────────────────────────

    exportFramesZip(name = 'Cape') {
        return new Promise((resolve, reject) => {
            if (!this._renderedFrames?.length) { reject(new Error('No frames')); return }
            if (typeof JSZip === 'undefined')  { reject(new Error('JSZip not loaded')); return }

            const zip    = new JSZip()
            const folder = zip.folder(name)
            const pad    = (n) => String(n).padStart(String(this._renderedFrames.length).length, '0')

            this._renderedFrames.forEach((frame, i) => {
                folder.file(`frame_${pad(i + 1)}.png`, frame.dataUrl.split(',')[1], { base64: true })
            })

            zip.generateAsync({ type: 'blob' }).then(blob => {
                const url  = URL.createObjectURL(blob)
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