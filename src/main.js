/**
 * MinecraftCapeCreator - with animated GIF support
 * Uses gifuct-js to decode GIF frames and animates them on the cape canvas.
 */

class MinecraftCapeCreator {
    constructor() {
        this.canvas = document.createElement('canvas')
        this.context = this.canvas.getContext('2d', { willReadFrequently: true });

        this.AUTO_COLOR = "auto"
        this.color = this.AUTO_COLOR
        this.scale = 1;
        this.elytraImage = true;

        // GIF animation state
        this._gifFrames = null;        // decoded frames array (null if not a GIF)
        this._gifFrameIndex = 0;
        this._gifAnimTimer = null;
        this._onFrameUpdate = null;    // callback called after each frame is painted

        // Raw file data (needed to re-decode GIF)
        this._imageData = null;        // ArrayBuffer if GIF, else null
        this._imageSrc = null;         // data URL for static images
    }

    // ─── Public setters ───────────────────────────────────────────────────────

    setColor(color) { this.color = color; }
    setAutoColor() { this.color = this.AUTO_COLOR; }

    setScale(scale) {
        let newScale = Math.max(1, Math.min(scale, 6));
        this.scale = Math.pow(2, newScale - 1);
    }

    /**
     * Accept either a data URL (static images) or an ArrayBuffer (for GIFs
     * when you want to pass raw bytes). The HTML side always passes a data URL,
     * so we detect GIFs by the data-URL header.
     */
    setImage(src) {
        this._stopGifAnimation();
        this._gifFrames = null;
        this._imageData = null;
        this._imageSrc = src;

        // Detect GIF by data-URL mime type
        if (src && src.startsWith('data:image/gif')) {
            // Convert base64 data URL → ArrayBuffer for gifuct-js
            const base64 = src.split(',')[1];
            const binary = atob(base64);
            const buf = new ArrayBuffer(binary.length);
            const bytes = new Uint8Array(buf);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            this._imageData = buf;
        }
    }

    setBackground(background) { this.background = background; }

    showOnElytra(value) { this.elytraImage = value; }

    /**
     * Register a callback that fires whenever a GIF frame is painted.
     * The callback receives the current canvas data URL.
     */
    onFrameUpdate(cb) { this._onFrameUpdate = cb; }

    // ─── Build / animate ──────────────────────────────────────────────────────

    buildCape() {
        this._stopGifAnimation();

        if (this._imageData) {
            // It's a GIF — decode then start animation loop
            return this._decodeGif(this._imageData).then(frames => {
                this._gifFrames = frames;
                this._gifFrameIndex = 0;
                return this._renderGifFrame(frames[0]);
            }).then(dataUrl => {
                this._startGifAnimation();
                return dataUrl;
            });
        } else {
            // Static image (or no image)
            return this._buildStaticCape(this._imageSrc);
        }
    }

    // ─── GIF decoding & animation ─────────────────────────────────────────────

    async _decodeGif(arrayBuffer) {
        // gifuct-js must be loaded globally (via script tag in HTML)
        const { parseGIF, decompressFrames } = window.gifuctJs;
        const gif = parseGIF(arrayBuffer);
        const frames = decompressFrames(gif, true); // true = patch each frame
        return frames;
    }

    _startGifAnimation() {
        if (!this._gifFrames || this._gifFrames.length <= 1) return;
        const tick = () => {
            const frame = this._gifFrames[this._gifFrameIndex];
            this._renderGifFrame(frame).then(dataUrl => {
                if (this._onFrameUpdate) this._onFrameUpdate(dataUrl);
                this._gifFrameIndex = (this._gifFrameIndex + 1) % this._gifFrames.length;
                // delay is in centiseconds in the GIF spec
                const delay = (frame.delay || 10) * 10;
                this._gifAnimTimer = setTimeout(tick, delay);
            });
        };
        const firstFrame = this._gifFrames[this._gifFrameIndex];
        const delay = (firstFrame.delay || 10) * 10;
        this._gifAnimTimer = setTimeout(tick, delay);
    }

    _stopGifAnimation() {
        if (this._gifAnimTimer) {
            clearTimeout(this._gifAnimTimer);
            this._gifAnimTimer = null;
        }
    }

    /**
     * Render a single decoded GIF frame onto an offscreen canvas,
     * then use that canvas as the "image" source for cape building.
     */
    _renderGifFrame(frame) {
        // Build an ImageData from the frame patch
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = frame.dims.width;
        frameCanvas.height = frame.dims.height;
        const frameCtx = frameCanvas.getContext('2d');

        // gifuct-js gives us a Uint8ClampedArray of RGBA pixels
        const imageData = frameCtx.createImageData(frame.dims.width, frame.dims.height);
        imageData.data.set(frame.patch);
        frameCtx.putImageData(imageData, 0, 0);

        // If the frame is a patch (disposal), we need to composite onto the full GIF canvas
        // For simplicity (and because most capes will be full-frame GIFs), we use the patch directly.
        const frameSrc = frameCanvas.toDataURL();
        return this._buildStaticCape(frameSrc);
    }

    // ─── Core cape rendering (static image or single frame) ───────────────────

    _buildStaticCape(imageSrc) {
        return new Promise(async (resolve, reject) => {
            const ctx = this.context;
            try {
                ctx.canvas.width = 64 * this.scale;
                ctx.canvas.height = 32 * this.scale;
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

                const calculateAverageColor = (image) => {
                    const { data } = image;
                    const length = data.length;
                    let count = 0;
                    let rgb = { r: 0, g: 0, b: 0 };
                    for (let i = 0; i < length; i += 5 * 4) {
                        count++;
                        rgb.r += data[i];
                        rgb.g += data[i + 1];
                        rgb.b += data[i + 2];
                    }
                    rgb.r = Math.floor(rgb.r / count);
                    rgb.g = Math.floor(rgb.g / count);
                    rgb.b = Math.floor(rgb.b / count);
                    return `#${((1 << 24) | (rgb.r << 16) | (rgb.g << 8) | rgb.b).toString(16).slice(1)}`;
                };

                const fillRect = (x, y, w, h) => ctx.fillRect(x * this.scale, y * this.scale, w * this.scale, h * this.scale);
                const clearRect = (x, y, w, h) => ctx.clearRect(x * this.scale, y * this.scale, w * this.scale, h * this.scale);

                const loadImage = (src) => new Promise((res, rej) => {
                    const i = new Image();
                    i.crossOrigin = "anonymous";
                    i.onload = () => res(i);
                    i.onerror = (e) => rej(e);
                    i.src = src;
                });

                let bgImg = null, fgImg = null;
                const tasks = [];
                if (this.background) tasks.push(loadImage(this.background).then(i => (bgImg = i)));
                if (imageSrc) tasks.push(loadImage(imageSrc).then(i => (fgImg = i)));

                await Promise.all(tasks);

                if (bgImg) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(bgImg, 0, 0, bgImg.width, bgImg.height, 0, 0, this.canvas.width, this.canvas.height);
                }

                if (fgImg) {
                    ctx.drawImage(fgImg, 1 * this.scale, 1 * this.scale, 10 * this.scale, 16 * this.scale);

                    if (this.color === this.AUTO_COLOR) {
                        const capeRegion = ctx.getImageData(1 * this.scale, 1 * this.scale, 10 * this.scale, 16 * this.scale);
                        ctx.fillStyle = calculateAverageColor(capeRegion);
                    } else {
                        ctx.fillStyle = this.color;
                    }

                    if (this.elytraImage) {
                        ctx.drawImage(fgImg, 36 * this.scale, 2 * this.scale, 10 * this.scale, 20 * this.scale);
                    } else if (!this.background) {
                        fillRect(36, 2, 10, 20);
                    }

                    if (!this.background) {
                        fillRect(0, 1, 1, 16);
                        fillRect(1, 0, 10, 1);
                        fillRect(11, 1, 1, 16);
                        fillRect(11, 0, 10, 1);
                        fillRect(12, 1, 10, 16);

                        fillRect(22, 11, 1, 11);
                        fillRect(31, 0, 3, 1);
                        fillRect(32, 1, 2, 1);
                        fillRect(34, 0, 6, 1);
                        fillRect(34, 2, 1, 2);
                        fillRect(35, 2, 1, 9);
                    }

                    if (!this.background || (this.background && this.elytraImage)) {
                        clearRect(36, 16, 1, 6);
                        clearRect(37, 19, 1, 3);
                        clearRect(38, 21, 1, 1);
                        clearRect(42, 2, 1, 1);
                        clearRect(43, 2, 1, 2);
                        clearRect(44, 2, 1, 5);
                        clearRect(45, 2, 1, 9);
                    }
                }

                resolve(ctx.canvas.toDataURL());
            } catch (err) {
                reject(err);
            }
        });
    }

    // ─── Download ─────────────────────────────────────────────────────────────

    downloadCape(name = "Cape") {
        let link = document.createElement('a');
        link.setAttribute('download', `${name}.png`);
        link.setAttribute('href', this.context.canvas.toDataURL("image/png").replace("image/png", "image/octet-stream"));
        link.click();
    }
}

window.MinecraftCapeCreator = MinecraftCapeCreator;
export default MinecraftCapeCreator;
