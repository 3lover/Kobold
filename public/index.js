import { decodePacket, encodePacket } from "./clientProtocol.js";
import { doc, createPopup, findAsset, psd, preferences, populateRightClick, randomColor} from "./sheetScripts.js";
import { sanitize } from "./helpers.js";

let socket = null;
let W, H, R;
function resize() {
    W = doc.gameCanvas.getBoundingClientRect().width;
    H = doc.gameCanvas.getBoundingClientRect().height;
    doc.gameCanvas.width = W;
    doc.gameCanvas.height = H;
    doc.buildCanvas.width = W;
    doc.buildCanvas.height = H;
    R = Math.min(W, H);
}
setInterval(resize, 200);

let mctx = doc.gameCanvas.getContext("2d");
mctx.lineCap = "round";
let buildctx = doc.buildCanvas.getContext("2d");
buildctx.lineCap = "round";

let protocol = null;
async function fetchProtocol() {
    protocol = await (await fetch("./json/protocol.json")).json();
}
await fetchProtocol();

const rootStyles = getComputedStyle(document.documentElement);
const colors = {};
function fetchColor(id) {
    if (colors[id] === undefined) colors[id] = rootStyles.getPropertyValue(`--${id}`).trim();
    return colors[id];
}

// lerps data
function lerp(from, to, p) {
    return from + (to - from) * p;
}

class SavedImage {
    constructor(p) {
        this.type = p.type ?? "image";
        this.data = p.data ?? "";
        this.id = p.id ?? Math.floor(Math.random() * 2**31);
        this.name = p.name ?? "";
        this.drawableObject = new Image();
        this.drawableObject.src = this.data;
    }
}

class Token {
    constructor(p, waitSync = false) {
        this.type = p.type ?? "token";
        this.id = p.id ?? Math.floor(Math.random() * 2**31);

        this.name = p.name ?? "Unnamed Token";
        this.description = p.description ?? "";

        this.radius = p.radius ?? 20;
        this.position = {x: p.position ? p.position.x : 0, y: p.position ? p.position.y : 0};
        this.originalPosition = {x: this.position.x, y: this.position.y};
        this.snapInterval = p.snapInterval ?? false;

        this.shape = p.shape ?? "circle";
        this.cropImage = p.cropImage ?? true;
        this.baseColor = p.baseColor ?? "red";
        this.lineColor = p.lineColor ?? "white";
        this.lineWidth = p.lineWidth ?? 5;
        this.zIndex = p.zIndex ?? 0;

        this.linkedSheet = p.linkedSheet ?? null;
        this.linkedSheetAwait = {id: p.linkedSheetAwait ? p.linkedSheetAwait.id : -1, name: p.linkedSheetAwait ? p.linkedSheetAwait.name : ""};
        this.linkedImage = p.linkedImage ?? null;
        this.linkedImageAwait = {id: p.linkedImageAwait ? p.linkedImageAwait.id : -1, name: p.linkedImageAwait ? p.linkedImageAwait.name : ""};
        this.removingLinked = false;
        this.trackedGridId = -1;
        this.tempImage = null;

        this.grabbingPlayer = p.grabbingPlayer ?? null;
        this.preventDefaultPosition = false;
        this.synced = p.synced ?? false;
        this.loaded = p.loaded ?? false;
        this.pinned = p.pinned ?? false;

        psd.unsavedChange = true;

        if (this.synced || waitSync) return;

        this.sendToken();
    }

    // unloads a token and tells the server to drop it
    delete() {
        this.loaded = false;
        socket.talk(encodePacket([protocol.server.deleteObject, this.id, this.name], ["int8", "int32", "string"]));
    }

    // checks if two tokens are the same visually, to avoid duplicate saves
    equals(other) {
        if (other.type !== "token") return false;
        if (this.name !== other.name) return false;
        if (this.description !== other.description) return false;
        if (this.radius !== other.radius) return false;
        if (this.snapInterval !== other.snapInterval) return false;
        if (this.shape !== other.shape) return false;
        if (this.cropImage !== other.cropImage) return false;
        if (this.baseColor !== other.baseColor) return false;
        if (this.lineColor !== other.lineColor) return false;
        if (this.lineWidth !== other.lineWidth) return false;
        if (this.zIndex !== other.zIndex) return false;
        if (this.linkedSheet !== other.linkedSheet) return false;
        if (this.linkedImage !== other.linkedImage) return false;
        return true;
    }

    // directly sends the token object to the server
    sendToken(oldid) {
        console.log("sending with old id" + oldid)
        const tokenLayout = [
            /* 00 */ protocol.server.tokenCreated, "int8",
            /* 01 */ this.type, "string",
            /* 02 */ this.id, "int32",
            /* 03 */ this.name, "string",
            /* 04 */ this.description, "string",
            /* 05 */ this.radius, "float32",
            /* 06 */ this.position.x, "float32",
            /* 07 */ this.position.y, "float32",
            /* 08 */ this.shape, "string",
            /* 09 */ this.cropImage ? 1 : 0, "int8",
            /* 10 */ this.baseColor, "string",
            /* 11 */ this.lineColor, "string",
            /* 12 */ this.lineWidth, "float32",
            /* 13 */ this.zIndex, "int32",
            /* 14 */ this.snapInterval ? 1 : 0, "int8",
            /* 15 */ this.linkedSheet ? this.linkedSheet.id : -1, "int32",
            /* 16 */ this.linkedSheet ? this.linkedSheet.name : "", "string",
            /* 17 */ this.linkedImage ? this.linkedImage.id : -1, "int32",
            /* 18 */ this.linkedImage ? this.linkedImage.name : "", "string",
            /* 19 */ oldid ?? this.id, "int32"
        ];
        const tokenData = tokenLayout.filter((e, i) => {return i % 2 === 0});
        const tokenTypes = tokenLayout.filter((e, i) => {return i % 2 === 1});
        socket.talk(encodePacket(tokenData, tokenTypes));

        // if the server doesn't have the image asset, send it over
        if (this.linkedImage) {
            socket.talk(encodePacket([protocol.server.assetInquiry, this.linkedImage.id, this.linkedImage.name], ["int8", "int32", "string"]));
        }
    }

    render(ctx = mctx, showcase = false, extras = {}) {
        const usedLineColor = extras.lineColor ?? this.lineColor;
        const usedBaseColor = extras.baseColor ?? this.baseColor;
        const usedShape = extras.shape ?? this.shape;
        const usedLineWidth = extras.lineWidth ?? this.lineWidth;
        const usedR = extras.tokenRadius ?? this.radius;
        const usedImage = extras.linkedImage ?? this.linkedImage;

        ctx.save();
        if (!this.synced) ctx.globalAlpha = 0.4;
        if (!showcase) ctx.translate(
            (this.position.x - psd.cameraLocation.x) * psd.cameraLocation.s + W/2,
            (this.position.y - psd.cameraLocation.y) * psd.cameraLocation.s + H/2
        );
        else ctx.translate(extras.x, extras.y);

        // if the token is being dragged, show the original location, and the distance moved if applicable
        if (this.grabbingPlayer !== null) {
            ctx.beginPath();
            ctx.lineWidth = psd.cameraLocation.s * this.radius * 0.1;
            ctx.strokeStyle = fetchColor(usedLineColor);
            let originalTrans = {
                x: (this.originalPosition.x - this.position.x) * psd.cameraLocation.s,
                y: (this.originalPosition.y - this.position.y) * psd.cameraLocation.s
            }
            switch (this.shape) {
                case "circle": {
                    ctx.arc(originalTrans.x, originalTrans.y, this.radius * psd.cameraLocation.s, 0, Math.PI * 2);
                    break;
                }
                case "square": {
                    ctx.rect(
                        originalTrans.x - this.radius * psd.cameraLocation.s,
                        originalTrans.y - this.radius * psd.cameraLocation.s,
                        this.radius * psd.cameraLocation.s * 2,
                        this.radius * psd.cameraLocation.s * 2
                    );
                    break;
                }
            }
            ctx.stroke();

            if (this.trackedGridId !== -1) {
                ctx.beginPath();
                ctx.lineWidth = psd.cameraLocation.s * this.radius * 0.2;
                ctx.setLineDash([psd.cameraLocation.s * 10, psd.cameraLocation.s * 10]);
                ctx.moveTo(originalTrans.x, originalTrans.y);
                ctx.lineTo(0, 0);
                ctx.stroke();
                ctx.setLineDash([]);

                // calculate how far this is on the tracked grid in cells, and draw that number
                let textPos = {
                    x: 0,
                    y: psd.cameraLocation.s * this.radius * 2,
                };
                let distance = 1;
                for (let grid of psd.grids) {
                    if (grid.id === this.trackedGridId) {
                        switch (grid.shape) {
                            case "square": {
                                distance = Math.sqrt(
                                    (this.position.x - this.originalPosition.x) ** 2 + (this.position.y - this.originalPosition.y) ** 2
                                ) / grid.radius;
                                break;
                            }
                            case "hexagon": {
                                distance = Math.sqrt(
                                    (this.position.x - this.originalPosition.x) ** 2 + (this.position.y - this.originalPosition.y) ** 2
                                ) / grid.radius * Math.sqrt(3)/2;
                                break;
                            }
                        }
                    }
                }
                distance = Math.round(distance * 10) / 10;
                ctx.save();
                ctx.lineWidth = psd.cameraLocation.s * this.radius * 0.05;
                ctx.fillStyle = fetchColor(usedLineColor);
                ctx.strokeStyle = fetchColor(usedBaseColor);
                ctx.font = `${psd.cameraLocation.s * this.radius * 0.6}px Jetbrains Mono`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.translate(textPos.x, textPos.y);
                ctx.strokeText(`${distance} Cells`, 0, 0);
                ctx.fillText(`${distance} Cells`, 0, 0);
                ctx.restore();
            }
        }
        
        ctx.lineWidth = usedLineWidth * psd.cameraLocation.s;
        if (showcase) ctx.lineWidth = extras.radius * usedLineWidth / usedR;

        // draw the color of the grabber in the background if needed
        if (this.grabbingPlayer !== null) {
            let grabber = "red";
            for (let player of psd.players) if (player.id === this.grabbingPlayer) grabber = player.mouseColor;
            ctx.beginPath();
            ctx.fillStyle = fetchColor(grabber);
            ctx.strokeStyle = fetchColor(grabber);
            switch (usedShape) {
                case "circle": {
                    ctx.arc(0, 0, this.radius * psd.cameraLocation.s, 0, Math.PI * 2);
                    break;
                }
                case "square": {
                    ctx.rect(-this.radius * psd.cameraLocation.s, -this.radius * psd.cameraLocation.s, this.radius * psd.cameraLocation.s * 2, this.radius * psd.cameraLocation.s * 2);
                    break;
                }
            }
            ctx.fill();
            if (this.lineWidth > 0) ctx.stroke();
        }

        // draw the base token
        ctx.beginPath();
        let radius = this.radius * psd.cameraLocation.s;
        let rmod = (this.grabbingPlayer === null ? 1 : 0.7);
        if (showcase) radius = extras.radius;
        switch (usedShape) {
            case "circle": {
                ctx.arc(0, 0, radius * rmod, 0, Math.PI * 2);
                break;
            }
            case "square": {
                ctx.rect(-radius * rmod, -radius * rmod, radius * rmod * 2, radius * rmod * 2);
                break;
            }
        }
        ctx.fillStyle = fetchColor(usedBaseColor);
        ctx.strokeStyle = fetchColor(usedLineColor);
        ctx.fill();
        if (this.lineWidth > 0) ctx.stroke();

        // draw the linked image, if one exists
        if (usedImage && usedImage.drawableObject.complete) {
            buildctx.clearRect(0, 0, W, H);
            buildctx.beginPath();
            switch (usedShape) {
                case "circle": {
                    buildctx.arc(radius * rmod, radius * rmod, radius * rmod, 0, Math.PI * 2);
                    break;
                }
                case "square": {
                    buildctx.rect(0, 0, radius * rmod * 2, radius * rmod * 2);
                    break;
                }
            }
            buildctx.fill();
            buildctx.globalCompositeOperation = "source-in";
            buildctx.drawImage(usedImage.drawableObject, 0, 0, radius * 2  * rmod, radius * 2 * rmod);
            buildctx.globalCompositeOperation = "source-over";

            ctx.drawImage(buildCanvas, -radius * rmod, -radius * rmod);
        }
        ctx.restore();
    }

    // takes in a location, and returns true if the token hitbox is within that location
    checkDrag(loc) {
        switch (this.shape) {
            case "circle": {
                return ((this.position.x - loc.x) ** 2 + (this.position.y - loc.y) ** 2) <= this.radius ** 2;
            }
            case "square": {
                return (Math.abs(this.position.x - loc.x) <= this.radius) && (Math.abs(this.position.y - loc.y) <= this.radius);
            }
        }
    }

    // when a user clicks a token, go through this to tell if it is being dragged or selected
    clicked(e) {
        const token = this;
        token.originalPosition = {x: token.position.x, y: token.position.y};
        token.preventDefaultPosition = true;
        token.trackedGridId = -1;
        for (let grid of psd.grids) {
            if (!grid.loaded) continue;
            if (grid.enableGridCount && grid.inside(this.position)) token.trackedGridId = grid.id;
        }

        // as we drag, move the token accordingly
        function moveToken(e2) {
            if (!token.preventDefaultPosition) {
                mouseUp(e2);
                return;
            }
            token.position.x = token.originalPosition.x - (e.clientX - e2.clientX) / psd.cameraLocation.s;
            token.position.y = token.originalPosition.y - (e.clientY - e2.clientY) / psd.cameraLocation.s;
            // snap it to the interval if we are on a grid with that turned on
            if (token.snapInterval) {
                let g = null;
                for (let grid of psd.grids) {
                    if (!grid.loaded) continue;
                    if (grid.inside(token.position)) g = grid;
                }
                if (g !== null) switch (g.shape) {
                    case "square": {
                        token.position.x = (Math.round((token.position.x - g.position.x) / g.radius + 0.5) - 0.5) * g.radius + g.position.x;
                        token.position.y = (Math.round((token.position.y - g.position.y) / g.radius + 0.5) - 0.5) * g.radius + g.position.y;
                        break;
                    }
                    case "hexagon": {
                        let radius = g.radius * 2/3;
                        let snapOptions = [];
                        // go through every nearby cell and check the distance
                        for (let i = 0; i < g.dim.x; i++) {
                            let polarity = i % 2 === 0 ? -1 : 1;
                            for (let j = 0; j < g.dim.y; j++) {
                                let ypos;
                                if (polarity === 1) {
                                    ypos = 0;
                                } else {
                                    ypos = radius * Math.sqrt(3)/2;
                                }
                                let snapPos = {
                                    x: g.position.x + radius * (i + 0.5) * 3/2 - g.realDim.x/2,
                                    y: g.position.y + radius * Math.sqrt(3) * (j + 0.5) + ypos - g.realDim.y/2
                                }
                                let dist = (snapPos.x - token.position.x) ** 2 + (snapPos.y - token.position.y) ** 2;
                                if (dist < (g.radius) ** 2) {
                                    snapOptions.push([snapPos.x, snapPos.y, dist]);
                                }
                            }
                        }
                        if (snapOptions.length < 1) break;
                        let closest = snapOptions[0];
                        for (let o of snapOptions) {
                            if (o[2] < closest[2]) {
                                closest = o;
                            }
                        }
                        token.position.x = closest[0];
                        token.position.y = closest[1];
                        break;
                    }
                }
            }

            socket.talk(encodePacket([protocol.server.tokenMoved, token.id, token.name, token.position.x, token.position.y], ["int8", "int32", "string", "float32", "float32"]));
        }
        // when we unclick, see how far we moved the token, and if we didn't move snap it and run a click event
        function mouseUp(e2) {
            document.removeEventListener("mousemove", moveToken);
            document.removeEventListener("mouseup", mouseUp);
            socket.talk(encodePacket([protocol.server.tokenReleased, token.id, token.name, token.position.x, token.position.y], ["int8", "int32", "string", "float32", "float32"]));

            if ((e2.clientX - e.clientX) ** 2 + (e2.clientY - e.clientY) ** 2 > 4) {
                return;
            }
            token.position = token.originalPosition;
            Token.openEditMenu(e2, token);
        }
        document.addEventListener("mousemove", moveToken);
        document.addEventListener("mouseup", mouseUp);

        socket.talk(encodePacket([protocol.server.tokenGrabbed, token.id, token.name], ["int8", "int32", "string"]));
    }

    // uses the token's data to populate the update menu
    sendToTokenMenu() {
        document.getElementById("tokenNameInput").value = this.name;
        document.getElementById("tokenDescriptionInput").value = this.description;
        document.getElementById("tokenRadiusInput").value = this.radius;
        document.getElementById("tokenBorderRadiusInput").value = this.lineWidth;
        document.getElementById("tokenZIndexInput").value = this.zIndex;
        document.getElementById("tokenGridSnapInput").value = this.snapInterval ? "1" : "0";
        document.getElementById("tokenColorInput").value = this.baseColor;
        document.getElementById("tokenBorderColorInput").value = this.lineColor;
        document.getElementById("tokenShapeInput").value = this.shape;
        document.getElementById("tokenImageFileDrop").value = "";
        document.getElementById("tokenImageFileDropLabel").innerText = this.linkedImage ? this.linkedImage.name : "Click to Upload a File";
    }

    // uses the update menu's data to update this token
    extractFromTokenMenu() {
        // if nothing changed, just ignore everything.
        if (
            this.name === sanitize(document.getElementById("tokenNameInput").value, "string", {max: 32, default: "Unnamed Token"}) &&
            this.description === sanitize(document.getElementById("tokenDescriptionInput").value, "string", {max: 1000, default: ""}) &&
            this.radius === sanitize(document.getElementById("tokenRadiusInput").value, "float", {min: 1, max: 1000, default: 20}) &&
            this.lineWidth === sanitize(document.getElementById("tokenBorderRadiusInput").value, "float", {min: 0, max: 1000, default: 5}) &&
            this.zIndex === sanitize(document.getElementById("tokenZIndexInput").value, "float", {min: -1000, max: 1000, default: 0}) &&
            this.snapInterval === (sanitize(document.getElementById("tokenGridSnapInput").value, "option", {valid: ["0", "1"], default: "0"}) === "1") &&
            this.baseColor === sanitize(document.getElementById("tokenColorInput").value, "color", {default: "red"}) &&
            this.lineColor === sanitize(document.getElementById("tokenBorderColorInput").value, "color", {default: "white"}) &&
            this.lineColor === sanitize(document.getElementById("tokenBorderColorInput").value, "color", {default: "white"}) &&
            this.shape === sanitize(document.getElementById("tokenShapeInput").value, "option", {valid: ["circle", "square"], default: "circle"}) &&
            document.getElementById("tokenImageFileDrop").files.length <= 0 &&
            !this.removingLinked
        ) return;

        let clone = new Token(this);
        clone.loaded = false;
        psd.tokens.push(clone);
        
        this.id = Math.floor(Math.random() * 2**31);
        if (this.removingLinked) this.linkedImage = null;
        this.removingLinked = false;
        this.name = sanitize(document.getElementById("tokenNameInput").value, "string", {max: 32, default: "Unnamed Token"});
        this.description = sanitize(document.getElementById("tokenDescriptionInput").value, "string", {max: 1000, default: ""});
        this.radius = sanitize(document.getElementById("tokenRadiusInput").value, "float", {min: 1, max: 1000, default: 20});
        this.lineWidth = sanitize(document.getElementById("tokenBorderRadiusInput").value, "float", {min: 0, max: 1000, default: 5});
        this.zIndex = sanitize(document.getElementById("tokenZIndexInput").value, "float", {min: -1000, max: 1000, default: 0});
        this.snapInterval = (sanitize(document.getElementById("tokenGridSnapInput").value, "option", {valid: ["0", "1"], default: "0"}) === "1");
        this.baseColor = sanitize(document.getElementById("tokenColorInput").value, "color", {default: "red"});
        this.lineColor = sanitize(document.getElementById("tokenBorderColorInput").value, "color", {default: "white"});
        this.shape = sanitize(document.getElementById("tokenShapeInput").value, "option", {valid: ["circle", "square"], default: "circle"});

        // wait until our image loads if we have one, otherwise just update it now
        const token = this;
        if (document.getElementById("tokenImageFileDrop").files.length > 0) {
            const reader = new FileReader();
            reader.onload = function() {
                const img = new SavedImage({
                    data: reader.result,
                    name: document.getElementById("tokenImageFileDrop").files[0].name
                });
                psd.images.push(img);
                token.linkedImage = img;
                
                token.sendToken(clone.id);
            };
            reader.readAsDataURL(document.getElementById("tokenImageFileDrop").files[0]);
        }
        else token.sendToken(clone.id);

        psd.unsavedChange = true;
    }

    static openEditMenu(e, token = null) {
        doc.tokenDataMenu.classList.remove("hidden");
        psd.inMenu = true;
        psd.currentEditObject = token;
        token.sendToTokenMenu();
        sendMouseUpdate(e);
    }
}

class Grid {
    constructor(p, waitSync) {
        this.type = p.type ?? "grid";
        this.id = p.id ?? Math.floor(Math.random() * 2**31);

        this.name = p.name ?? "Unnamed Grid";

        this.radius = p.radius ?? 50;
        this.dim = p.dim ?? {x: 10, y: 10};
        this.position = p.position ?? {x: 0, y: 0};
        this.realDim = p.realDim ?? {x: this.radius * this.dim.x, y: this.radius * this.dim.y};
        this.enableGridCount = p.enableGridCount ?? false;

        this.shape = p.shape ?? "square";
        this.lineColor = p.lineColor ?? "red";
        this.lineWidth = p.lineWidth ?? 2;
        this.zIndex = p.zIndex ?? -1;

        this.linkedImage = p.linkedImage ?? null;
        this.linkedImageAwait = p.linkedImageAwait ?? {id: -1, name: ""};
        this.removingLinked = false;

        this.synced = p.synced ?? false;
        this.loaded = p.loaded ?? false;
        this.pinned = p.pinned ?? false;

        psd.unsavedChange = true;

        if (this.synced || waitSync) return;

        this.sendGrid();
    }

    // unloads a grid and tells the server to drop it
    delete() {
        this.loaded = false;
        socket.talk(encodePacket([protocol.server.deleteObject, this.id, this.name], ["int8", "int32", "string"]));
    }

    // checks if two grids are the same visually, to avoid duplicate saves
    equals(other) {
        if (other.type !== "grid") return false;
        if (this.name !== other.name) return false;
        if (this.radius !== other.radius) return false;
        if (this.dim.x !== other.dim.x || this.dim.y !== other.dim.y) return false;
        if (this.shape !== other.shape) return false;
        if (this.lineColor !== other.lineColor) return false;
        if (this.lineWidth !== other.lineWidth) return false;
        if (this.zIndex !== other.zIndex) return false;
        if (this.linkedImage !== other.linkedImage) return false;
        return true;
    }

    // directly sends the token object to the server
    sendGrid(oldid) {
        const gridLayout = [
            /* 00 */ protocol.server.gridCreated, "int8",
            /* 01 */ this.type, "string",
            /* 02 */ this.id, "int32",
            /* 03 */ this.name, "string",
            /* 04 */ this.radius, "float32",
            /* 05 */ this.dim.x, "float32",
            /* 06 */ this.dim.y, "float32",
            /* 07 */ this.position.x, "float32",
            /* 08 */ this.position.y, "float32",
            /* 09 */ this.shape, "string",
            /* 10 */ this.lineColor, "string",
            /* 11 */ this.lineWidth, "float32",
            /* 12 */ this.zIndex, "int32",
            /* 13 */ this.enableGridCount ? 1 : 0, "int8",
            /* 13 */ this.linkedImage ? this.linkedImage.id : -1, "int32",
            /* 14 */ this.linkedImage ? this.linkedImage.name : "", "string",
            /* 15 */ oldid ?? this.id, "int32"
        ];
        const gridData = gridLayout.filter((e, i) => {return i % 2 === 0});
        const gridTypes = gridLayout.filter((e, i) => {return i % 2 === 1});
        socket.talk(encodePacket(gridData, gridTypes));

        // if the server doesn't have the image asset, send it over
        if (this.linkedImage) {
            socket.talk(encodePacket([protocol.server.assetInquiry, this.linkedImage.id, this.linkedImage.name], ["int8", "int32", "string"]));
        }
    }

    render(ctx = mctx, showcase = false, extras = {}) {
        switch (this.shape) {
            case "square": this.realDim = {x: this.radius * this.dim.x, y: this.radius * this.dim.y}; break;
            case "hexagon": this.realDim = {x: this.radius * this.dim.x, y: this.radius * 2/3 * Math.sqrt(3) * (this.dim.y + 0.5)}; break;
        }
        
        ctx.beginPath();
        ctx.save();
        if (!showcase) ctx.translate(
            (this.position.x - psd.cameraLocation.x) * psd.cameraLocation.s + W/2,
            (this.position.y - psd.cameraLocation.y) * psd.cameraLocation.s + H/2
        );
        else ctx.translate(extras.radius, extras.radius);

        
        let radius = {x: (this.realDim.x / 2) * psd.cameraLocation.s, y: (this.realDim.y / 2) * psd.cameraLocation.s};
        if (showcase) radius = {x: extras.radius, y: extras.radius};
        ctx.translate(-radius.x, -radius.y);
        ctx.strokeStyle = fetchColor(this.lineColor);
        if (!showcase) ctx.lineWidth = this.lineWidth * psd.cameraLocation.s;
        else ctx.lineWidth = extras.radius * this.lineWidth / this.realDim.x;
        
        // draw the linked image, if one exists
        radius = this.realDim.x * psd.cameraLocation.s;
        if (showcase) radius = extras.radius * 2;
        if (this.linkedImage && this.linkedImage.drawableObject.complete) {
            ctx.beginPath();
            let ratio = this.linkedImage.drawableObject.height / this.linkedImage.drawableObject.width;
            ctx.drawImage(this.linkedImage.drawableObject, 0, 0, radius, radius * ratio);
        }
        
        switch (this.shape) {
            case "square": {
                radius = this.radius;
                if (showcase) radius = extras.radius * 2 / this.dim.x;
                for (let i = 0; i < this.dim.x + 1; i++) {
                    ctx.moveTo(radius * i * psd.cameraLocation.s, 0);
                    ctx.lineTo(radius * i * psd.cameraLocation.s, radius * this.dim.y * psd.cameraLocation.s);
                }
                for (let i = 0; i < this.dim.y + 1; i++) {
                    ctx.moveTo(0, radius * i * psd.cameraLocation.s);
                    ctx.lineTo(radius * this.dim.x * psd.cameraLocation.s, radius * i * psd.cameraLocation.s);
                }
                if (this.lineWidth > 0) ctx.stroke();
                break;
            }
            case "hexagon": {
                function renderHex(x, y, r) {
                    ctx.beginPath();
                    ctx.moveTo(x + r, y);
                    for (let i = 0; i <= 6; i++) {
                        ctx.lineTo(x + r * Math.cos(i * Math.PI/3), y + r * Math.sin(i * Math.PI/3));
                    }
                    ctx.stroke();
                }
                radius = this.radius * 2/3;
                if (showcase) radius = extras.radius * 2 / this.dim.x * 2/3;
                // create the grid
                for (let i = 0; i < this.dim.x; i++) {
                    let polarity = i % 2 === 0 ? -1 : 1;
                    for (let j = 0; j < this.dim.y; j++) {
                        let ypos;
                        if (polarity === 1) {
                            ypos = 0;
                        } else {
                            ypos = radius * Math.sqrt(3)/2 * psd.cameraLocation.s;
                        }
                        renderHex(radius * (i + 0.5) * 3/2 * psd.cameraLocation.s, radius * Math.sqrt(3) * (j + 0.5) * psd.cameraLocation.s + ypos, radius * psd.cameraLocation.s);
                    }
                }
                break;
            }
            default: {
                console.log("unknown grid shape requested");
                return;
            }
        }

        ctx.restore();
    }

    // returns true if a location falls within this bound
    inside(loc) {
        if (loc.x < this.position.x - this.realDim.x/2 || loc.x > this.position.x + this.realDim.x/2) return false;
        if (loc.y < this.position.y - this.realDim.y/2 || loc.y > this.position.y + this.realDim.y/2) return false;
        return true;
    }

    // uses the token's data to populate the update menu
    sendToGridMenu() {
        document.getElementById("gridNameInput").value = this.name;
        document.getElementById("gridRadiusInput").value = this.radius;
        document.getElementById("gridXDimInput").value = this.dim.x;
        document.getElementById("gridYDimInput").value = this.dim.y;
        document.getElementById("gridXPosInput").value = this.position.x;
        document.getElementById("gridYPosInput").value = this.position.y;
        document.getElementById("gridLineWidthInput").value = this.lineWidth;
        document.getElementById("gridLineColorInput").value = this.lineColor;
        document.getElementById("gridZIndexInput").value = this.zIndex;
        document.getElementById("gridEnableCountInput").value = this.enableGridCount ? "1" : "0";
        document.getElementById("gridShapeInput").value = this.shape;
        document.getElementById("gridImageFileDrop").value = "";
        document.getElementById("gridImageFileDropLabel").innerText = this.linkedImage ? this.linkedImage.name : "Click to Upload a File";
    }

    // uses the update menu's data to update this token
    extractFromGridMenu() {
        // if nothing changed ignore the extraction
        if (
            this.name === sanitize(document.getElementById("gridNameInput").value, "string", {max: 32, default: "Unnamed Grid"}) &&
            this.radius === sanitize(document.getElementById("gridRadiusInput").value, "float", {min: 1, max: 1000, default: 50}) &&
            this.dim.x === sanitize(document.getElementById("gridXDimInput").value, "float", {min: 1, max: 1000, default: 10}) &&
            this.dim.y === sanitize(document.getElementById("gridYDimInput").value, "float", {min: 1, max: 1000, default: 10}) &&
            this.position.x === sanitize(document.getElementById("gridXPosInput").value, "float", {min: -1000000, max: 1000000, default: 0}) &&
            this.position.y === sanitize(document.getElementById("gridYPosInput").value, "float", {min: -1000000, max: 1000000, default: 0}) &&
            this.lineWidth === sanitize(document.getElementById("gridLineWidthInput").value, "float", {min: 0, max: 1000, default: 2}) &&
            this.lineColor === sanitize(document.getElementById("gridLineColorInput").value, "color", {default: "white"}) &&
            this.zIndex === sanitize(document.getElementById("gridZIndexInput").value, "float", {min: -1000, max: 1000, default: 0}) &&
            this.enableGridCount === sanitize(document.getElementById("gridEnableCountInput").value, "option", {valid: ["0", "1"], default: "0"}) &&
            this.shape === sanitize(document.getElementById("gridShapeInput").value, "option", {valid: ["hexagon", "square"], default: "square"}) &&
            document.getElementById("gridImageFileDrop").files.length <= 0 &&
            !this.removingLinked
        ) return;

        let clone = new Grid(this);
        clone.loaded = false;
        psd.grids.push(clone);
        
        this.id = Math.floor(Math.random() * 2**31);
        if (this.removingLinked) this.linkedImage = null;
        this.removingLinked = false;
        this.name = sanitize(document.getElementById("gridNameInput").value, "string", {max: 32, default: "Unnamed Grid"});
        this.radius = sanitize(document.getElementById("gridRadiusInput").value, "float", {min: 1, max: 1000, default: 50});
        this.dim.x = sanitize(document.getElementById("gridXDimInput").value, "float", {min: 1, max: 1000, default: 10});
        this.dim.y = sanitize(document.getElementById("gridYDimInput").value, "float", {min: 1, max: 1000, default: 10});
        this.position.x = sanitize(document.getElementById("gridXPosInput").value, "float", {min: -1000000, max: 1000000, default: 0});
        this.position.y = sanitize(document.getElementById("gridYPosInput").value, "float", {min: -1000000, max: 1000000, default: 0});
        this.lineWidth = sanitize(document.getElementById("gridLineWidthInput").value, "float", {min: 0, max: 1000, default: 2});
        this.lineColor = sanitize(document.getElementById("gridLineColorInput").value, "color", {default: "white"});
        this.zIndex = sanitize(document.getElementById("gridZIndexInput").value, "float", {min: -1000, max: 1000, default: 0});
        this.enableGridCount = sanitize(document.getElementById("gridEnableCountInput").value, "option", {valid: ["0", "1"], default: "0"}) === "1";
        this.shape = sanitize(document.getElementById("gridShapeInput").value, "option", {valid: ["hexagon", "square"], default: "square"});

        // wait until our image loads if we have one, otherwise just update it now
        const grid = this;
        if (document.getElementById("gridImageFileDrop").files.length > 0) {
            const reader = new FileReader();
            reader.onload = function() {
                const img = new SavedImage({
                    data: reader.result,
                    name: document.getElementById("gridImageFileDrop").files[0].name
                });
                psd.images.push(img);
                grid.linkedImage = img;
                
                grid.sendGrid(clone.id);
            };
            reader.readAsDataURL(document.getElementById("gridImageFileDrop").files[0]);
        }
        else grid.sendGrid(clone.id);

        psd.unsavedChange = true;
    }

    // opens the grid edit menu
    static openEditMenu(e, grid = null) {
        if (grid === null) return;
        doc.gridDataMenu.classList.remove("hidden");
        psd.inMenu = true;
        psd.currentEditObject = grid;
        grid.sendToGridMenu();
        sendMouseUpdate(e);
    }
}

class PlayerState {
    constructor(p) {
        this.id = p.id;
        this.mouseLocation = p.mouseLocation ?? {x: 0, y: 0};
        this.realMouseLocation = p.mouseLocation ?? {x: 0, y: 0};
        this.mouseColor = p.mouseColor ?? "red";
        this.inMenu = p.inMenu ?? false;
        this.isHost = p.isHost ?? false;
        this.tick = new Date().getTime();
    }

    lerpPosition() {
        this.mouseLocation.x = lerp(this.mouseLocation.x, this.realMouseLocation.x, 0.6);
        this.mouseLocation.y = lerp(this.mouseLocation.y, this.realMouseLocation.y, 0.6);
    }

    renderMouse(ctx = mctx) {
        ctx.beginPath();
        ctx.arc(
            (this.mouseLocation.x - psd.cameraLocation.x) * psd.cameraLocation.s + W/2,
            (this.mouseLocation.y - psd.cameraLocation.y) * psd.cameraLocation.s + H/2,
            5 * psd.cameraLocation.s, 0, Math.PI * 2
        );
        if (this.inMenu) {
            ctx.strokeStyle = fetchColor(this.mouseColor);
            ctx.lineWidth = 5 * psd.cameraLocation.s;
            ctx.stroke();
        }
        else {
            ctx.fillStyle = fetchColor(this.mouseColor);
            ctx.fill();
        }
    }
}

// our websocket connection
class Socket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.pingsocket = false;
        this.inLobby = false;
        this.recoveredMapData = "";
        this.id = Math.random();
    }

    connect() {
        if (this.socket !== null) {
            document.getElementById("reconnectPrompter").classList.add("hidden");
            return;
        }
        if (!this.pingsocket) document.getElementById("reconnectPrompter").classList.remove("hidden");
        this.socket = new WebSocket("wss://" + location.host + "/wss");
        this.socket.binaryType = "arraybuffer";
        this.socket.onopen = () => this.open();
        this.socket.onmessage = (data) => this.message(data);
        this.socket.onerror = (error) => this.error(error);
        this.socket.onclose = (reason) => this.close(reason);
    }

    disconnect() {
        if (this.socket === null) return;
        this.socket.close();
        this.socket = null;
        this.connected = false;
        if (this.pingsocket) return;
        document.getElementById("reconnectPrompter").classList.remove("hidden");
        if (this.inLobby) {
            console.log("Connection Lost");
            createPopup(
                "Connection Lost", `You have been disconnected from this lobby due to problems on the server-side. You may press "Save Map" To export the map and import it later.`, {type: 0},
                "Save Map", function(e) {
                    document.getElementById("exportMapButton").click();
                    return false;
                },
                "Reconnect", function(e) {
                    socket.connect();
                    return true;
                },
            );
        }
    }

    talk(data) {
        if (this.socket === null) return;
        if (this.socket.readyState === 1) this.socket.send(data);
    }

    message(packet) {
        if (this.pingsocket) return;
        let reader = new DataView(packet.data);

        switch (reader.getInt8(0)) {
            // confirm that the server can hear us
            case protocol.client.connected: {
                console.log(`Connection confirmed by server on port "${location.host}"`);
                this.connected = true;
                document.getElementById("reconnectPrompter").classList.add("hidden");
                break;
            }
            // if we tried to create a lobby and failed, ask if we want to join it instead
            case protocol.client.lobbyWithCodeAlreadyExists: {
                createPopup(
                    "Lobby Already Exists", `Creating a lobby failed since a lobby with the code '${document.getElementById("frontCreateGameCodeInput").value}' already exists.\n\nDo you want to join this lobby instead?"`, {type: 0},
                    "Cancel", function(e) {return true},
                    "Join Lobby", function(e) {
                        moveHolders(document.getElementById("frontCreateGameHolder"), document.getElementById("frontJoinGameHolder"));
                        document.getElementById("frontJoinGameNameInput").value = document.getElementById("frontCreateGameNameInput").value;
                        document.getElementById("frontJoinGameCodeInput").value = document.getElementById("frontCreateGameCodeInput").value;
                        return true;
                    }
                );
                break;
            }
            // if we tried to join a lobby and failed, ask if we want to host instead
            case protocol.client.noLobbyWithCode: {
                createPopup(
                    "No Lobby Found", `A lobby could not be found with the code '${document.getElementById("frontJoinGameCodeInput").value}'.\n\nDo you want to create a lobby with this code instead?"`, {type: 0},
                    "Cancel", function(e) {return true},
                    "Create Lobby", function(e) {
                        moveHolders(document.getElementById("frontJoinGameHolder"), document.getElementById("frontCreateGameHolder"));
                        document.getElementById("frontCreateGameNameInput").value = document.getElementById("frontJoinGameNameInput").value;
                        document.getElementById("frontCreateGameCodeInput").value = document.getElementById("frontJoinGameCodeInput").value;
                        return true;
                    }
                );
                break;
            }
            // if we successfully join/create a lobby, move us to the lobby drop page and send our assets
            case protocol.client.successfulLobbyRequest: {
                const d = decodePacket(reader, ["int8", "string", "int32"]);
                document.getElementById("simulatorMenu").classList.remove("hidden");
                resize();
                document.getElementById("frontMenu").classList.add("hidden");
                document.getElementById("loadingScreen").classList.remove("hidden");
                this.inLobby = true;
                psd.myId = d[2];
                console.log(`Successfully connected to lobby with code ${d[1]}.`);
                if (this.recoveredMapData) {
                    createPopup(
                        "Restore Map?", `Do you want to restore the map from before the disconnect?`, {type: 0},
                        "Yes", function(e) {
                            importFromData(JSON.parse(socket.recoveredMapData));
                            return true;
                        },
                        "No", function(e) {return true}
                    );
                }
                sendMouseUpdate({clientX: W/2, clientY: H/2});
                break;
            }
            // the server is asking if we own the needed assets and if we don't own any, we request them
            case protocol.client.assetInquiryPacket: {
                const d = decodePacket(reader, ["int8", "repeat", "int32", "string", "end"]);
                let requestedAssets = [protocol.server.requestedAssets, 0];
                for (let i = 0; i < d[1].length; i += 2) {
                    const a = findAsset(d[1][i + 0], d[1][i + 1]);
                    if (a === null) {
                        console.log("oh shit, let me grab dat")
                        requestedAssets.push(d[1][i + 0], d[1][i + 1]);
                        requestedAssets[1]++;
                    }
                    else {
                        if (a.type === "token") a.synced = true;
                    }
                }
                requestedAssets.push(0);
                socket.talk(encodePacket(requestedAssets, ["int8", "repeat", "int32", "string", "end"]));
                document.getElementById("loadingScreen").classList.remove("hidden");
                break;
            }
            // when the server sends us our requested assets, save them to our asset storage
            case protocol.client.assetDataPacket: {
                const d = decodePacket(reader, [
                    "int8", 
                    "repeat", "int32", "string", "string", "end", 
                    "repeat", 'string', 'int32', 'string', 'string', 'float32', 'float32', 'float32', 'string', 'int8', 'string', 'string', 'float32', 'int32', "int8", 'int32', 'string', 'int32', 'string', "int32", "end",
                    "repeat", "string", "int32", "string", "float32", "float32", "float32", "float32", "float32", "string", "string", "float32", "int32", "int8", "int32", "string", "int32", "end"
                ]);
                console.log("Data packet recieved!");
                for (let i = 0; i < d[1].length; i += 3) {
                    if (findAsset(d[1][i + 0], d[1][i + 1]) !== null) continue;
                    psd.images.push(new SavedImage({
                        id: d[1][i + 0],
                        name: d[1][i + 1],
                        data: d[1][i + 2],
                    }));
                }
                for (let i = 0; i < d[2].length; i += 19) {
                    if (findAsset(d[2][i + 1], d[2][i + 2]) !== null) continue;
                    psd.tokens.push(new Token({
                        type: d[2][i + 0],
                        id: d[2][i + 1],
                        name: d[2][i + 2],
                        description: d[2][i + 3],
                        radius: d[2][i + 4],
                        position: {x: d[2][i + 5], y: d[2][i + 6]},
                        shape: d[2][i + 7],
                        cropImage: d[2][i + 8],
                        baseColor: d[2][i + 9],
                        lineColor: d[2][i + 10],
                        lineWidth: d[2][i + 11],
                        zIndex: d[2][i + 12],
                        snapInterval: !!d[2][i + 13],
                        linkedSheetAwait: {id: d[2][i + 14], name: d[2][i + 15]},
                        linkedImageAwait: {id: d[2][i + 16], name: d[2][i + 17]},
                        grabbingPlayer: d[2][i + 18] === -1 ? null : d[2][i + 18],
                        synced: true,
                    }));
                }
                for (let i = 0; i < d[3].length; i += 15) {
                    if (findAsset(d[3][i + 1], d[3][i + 2]) !== null) continue;
                    psd.grids.push(new Grid({
                        type: d[3][i + 0],
                        id: d[3][i + 1],
                        name: d[3][i + 2],
                        radius: d[3][i + 3],
                        dim: {x: d[3][i + 4], y: d[3][i + 5]},
                        position: {x: d[3][i + 6], y: d[3][i + 7]},
                        shape: d[3][i + 8],
                        lineColor: d[3][i + 9],
                        lineWidth: d[3][i + 10],
                        zIndex: d[3][i + 11],
                        enableGridCount: !!d[3][i + 12],
                        linkedImageAwait: {id: d[3][i + 13], name: d[3][i + 14]},
                        synced: true,
                    }));
                }
                document.getElementById("loadingScreen").classList.add("hidden");
                break;
            }
            // when we get a basic update, extract everything and update stuff
            case protocol.client.basicUpdate: {
                const d = decodePacket(reader, [
                    "int8",
                    "repeat", "int32", "float32", "float32", "string", "int8", "int8", "end",
                    "repeat", "int32", "string", "float32", "float32", "end",
                    "repeat", "int32", "string", "end"
                ]);
                // update player mouse positions
                for (let i = 0; i < d[1].length; i += 6) {
                    let other = null;
                    for (let player of psd.players) if (player.id === d[1][i + 0]) {other = player; break;}
                    if (other === null) {
                        other = new PlayerState({
                            id: d[1][i + 0],
                            mouseLocation: {x: d[1][i + 1], y: d[1][i + 2]},
                            mouseColor: d[1][i + 3],
                            inMenu: !!d[1][i + 4],
                            isHost: !!d[1][i + 5],
                        });
                        psd.players.push(other);
                    }
                    other.realMouseLocation = {x: d[1][i + 1], y: d[1][i + 2]};
                    other.mouseColor = d[1][i + 3];
                    other.inMenu = !!d[1][i + 4];
                    other.isHost = !!d[1][i + 5];
                    other.tick = new Date().getTime();
                    if (psd.myId === other.id) psd.isHost = other.isHost;
                }
                // update token locations
                for (let token of psd.tokens) {
                    let found = false;
                    for (let i = 0; i < d[2].length; i += 4) {
                        if (token.id === d[2][i + 0] && token.name === d[2][i + 1]) {
                            found = true;
                            token.loaded = true;
                            if (!token.preventDefaultPosition) {
                                token.position.x = d[2][i + 2];
                                token.position.y = d[2][i + 3];
                            }
                            break;
                        }
                    }
                    if (!found) {
                        token.loaded = false;
                    }
                }
                // update existing grids
                for (let grid of psd.grids) {
                    let found = false;
                    for (let i = 0; i < d[3].length; i += 2) {
                        if (grid.id === d[3][i + 0] && grid.name === d[3][i + 1]) {
                            found = true;
                            grid.loaded = true;
                            break;
                        }
                    }
                    if (!found) {
                        grid.loaded = false;
                    }
                }

                break;
            }
            // when a token is grabbed, check if it is us, and if not release our grip if we have one
            case protocol.client.tokenGrabbed: {
                const d = decodePacket(reader, ["int8", "int32", "string", "int32"]);
                let t = null;
                for (let token of psd.tokens) if (token.id === d[1] && token.name === d[2]) {t = token; break;}
                if (t === null) {
                    console.warn("Unrecognized Token Grabbed");
                    break;
                }

                if (d[3] !== psd.myId) t.preventDefaultPosition = false;
                t.grabbingPlayer = d[3];
                break;
            }
            // if a token is released, do all that entails
            case protocol.client.tokenReleased: {
                const d = decodePacket(reader, ["int8", "int32", "string"]);
                let t = null;
                for (let token of psd.tokens) if (token.id === d[1] && token.name === d[2]) {t = token; break;}
                if (t === null) {console.warn("Unrecognized Token Released"); break;}

                t.preventDefaultPosition = false;
                t.grabbingPlayer = null;
                break;
            }
            // if the server requests an asset it doesn't have, send it
            case protocol.client.assetSendRequest: {
                const d = decodePacket(reader, ["int8", "int32", "string"]);
                let asset = findAsset(d[1], d[2]);
                if (findAsset === null) break;
                socket.talk(encodePacket(
                    [protocol.server.uploadRequiredAssets, 1, asset.id, asset.name, asset.data, 0],
                    ["int8", "repeat", "int32", "string", "string", "end"]
                ));
                break;
            }
            default: {
                console.warn(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                break;
            }
        }
    }

    open() {
        if (!this.pingsocket) console.log("Socket connected");
        if (this.inLobby) {
            if (psd.joined) {
                socket.talk(encodePacket([
                    protocol.server.joinLobby,
                    document.getElementById("frontJoinGameNameInput").value,
                    document.getElementById("frontJoinGameCodeInput").value,
                    socket.id
                ], ["int8", "string", "string", "float32"]));
            }
            else {
                socket.talk(encodePacket([
                    protocol.server.createLobby,
                    document.getElementById("frontCreateGameNameInput").value,
                    document.getElementById("frontCreateGameCodeInput").value,
                    socket.id
                ], ["int8", "string", "string", "float32"]));
                this.recoveredMapData = exportMapData();
            }
        }
    }

    error(error) {
        console.error(error);
    }

    close(reason) {
        if (!this.pingsocket) console.log(`Socket closed for reason:`);
        if (!this.pingsocket) console.log(reason)
        this.disconnect();
    }
}

socket = new Socket();
socket.connect();
document.getElementById("loadingScreen").classList.add("hidden");

// when dragging across the canvas, change the camera position
doc.gameCanvas.addEventListener("mousedown", function(e) {
    if (e.button === 2) return;
    if (psd.inMenu) {
        psd.inMenu = false;
        doc.tokenDataMenu.classList.add("hidden");
        doc.gridDataMenu.classList.add("hidden");
        doc.saveStateMenu.classList.add("hidden");
        if (psd.currentEditObject === null) return;
        if (psd.currentEditObject.type === "token") psd.currentEditObject.extractFromTokenMenu();
        else if (psd.currentEditObject.type === "grid") psd.currentEditObject.extractFromGridMenu();
        psd.currentEditObject = null;
        sendMouseUpdate(e);
        return;
    }

    // go through all our tokens and see if we are trying to grab one
    let grabbedToken = null;
    for (let token of psd.tokens) {
        if (!token.loaded) continue;
        if (grabbedToken !== null && token.zIndex < grabbedToken.zIndex) continue;
        if (!token.checkDrag({
            x: (e.clientX - W/2) / psd.cameraLocation.s + psd.cameraLocation.x,
            y: (e.clientY - H/2) / psd.cameraLocation.s + psd.cameraLocation.y,
        })) continue;
        grabbedToken = token;
    }
    if (grabbedToken) {
        grabbedToken.clicked(e);
        return;
    }


    // if we failed to find a drag, or if we are panning, latch to our camera and move it
    psd.originalCameraLocation = structuredClone(psd.cameraLocation);
    function drag(e2) {
        psd.cameraLocation.x = psd.originalCameraLocation.x + (e.clientX - e2.clientX) / psd.cameraLocation.s;
        psd.cameraLocation.y = psd.originalCameraLocation.y + (e.clientY - e2.clientY) / psd.cameraLocation.s;
    }
    function release(e2) {
        document.removeEventListener("mousemove", drag);
        document.removeEventListener("mouseup", release);
    }
    
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", release);
});

// when we scroll, adjust the zoom
doc.gameCanvas.addEventListener("wheel", function(e) {
    let relativeX = e.clientX - W/2;
    let relativeY = e.clientY - H/2;
    let newScroll = psd.cameraLocation.s * (1 - 0.1 * Math.sign(e.deltaY));
    newScroll = Math.min(Math.max(newScroll, 0.2), 10);
    
    psd.cameraLocation.x = psd.cameraLocation.x + (relativeX / psd.cameraLocation.s) - (relativeX / newScroll);
    psd.cameraLocation.y = psd.cameraLocation.y + (relativeY / psd.cameraLocation.s) - (relativeY / newScroll);
    
    psd.cameraLocation.s = newScroll;
});

// when the mouse moves, update the server with this info
function sendMouseUpdate(e) {
    if (!socket.inLobby) return;
    if (!psd.inMenu) psd.mousePosition = {x: e.clientX, y: e.clientY};
    socket.talk(encodePacket([
        protocol.server.mouseMoveData,
        psd.cameraLocation.x,
        psd.cameraLocation.y,
        (psd.mousePosition.x - W/2) / psd.cameraLocation.s,
        (psd.mousePosition.y - H/2) / psd.cameraLocation.s,
        psd.inMenu ? 1 : 0,
        preferences.mouseColor,
    ], ["int8", "float32", "float32", "float32", "float32", "int8", "string"]));
}
doc.gameCanvas.addEventListener("mousemove", sendMouseUpdate);


/* Sense where a player right clicks, and add menu options accordingly */
doc.gameCanvas.addEventListener("contextmenu", function(e) {
    if ((psd.clickCombo[1] - e.clientX) ** 2 + (psd.clickCombo[2] - e.clientY) ** 2 < 16) psd.clickCombo[0]++;
    else psd.clickCombo[0] = 0;
    psd.clickCombo[1] = e.clientX;
    psd.clickCombo[2] = e.clientY;

    let clickOptions = [{
        name: "Create Token (testing)",
        function: function() {
            psd.tokens.push(new Token({
                name: "Random Token",
                description: "Something cool goes here I think",
                position: {
                    x: psd.cameraLocation.x + (e.clientX - W/2) / psd.cameraLocation.s,
                    y: psd.cameraLocation.y + (e.clientY - H/2) / psd.cameraLocation.s
                },
                baseColor: randomColor(),
            }));
        }
    }, {
        name: "Create Grid (testing)",
        function: function() {
            psd.grids.push(new Grid({
                name: "Random Grid",
                position: {
                    x: psd.cameraLocation.x + (e.clientX - W/2) / psd.cameraLocation.s,
                    y: psd.cameraLocation.y + (e.clientY - H/2) / psd.cameraLocation.s
                },
                lineColor: "white",
            }));
        }
    }, {
        name: "Export/Import Map",
        function: function() {
            doc.saveStateMenu.classList.remove("hidden");
            psd.inMenu = true;
            // create the saved object listings
            while (document.getElementById("saveStateObjectHoldingMenu").children.length > 0) {
                document.getElementById("saveStateObjectHoldingMenu").lastChild.remove();
            }
            let addedObjs = [];
            let objList = psd.tokens.concat(psd.grids);
            for (let o of objList) {
                // test to not add duplicates
                let found = false;
                for (let previousObj of addedObjs) if (previousObj.equals(o)) found = true;
                if (found) continue;
                addedObjs.push(o);

                let holder = document.createElement("div");
                holder.classList.add("saveStateObjectHolder");

                // add a render
                let drawing = document.createElement("canvas");
                drawing.classList.add("saveStateObjectHolderCanvas");
                drawing.width = H/2;
                drawing.height = H/2;
                let drawingctx = drawing.getContext("2d");
                o.render(drawingctx, true, {radius: H/6, x: H/4, y: H/4});
                holder.appendChild(drawing);
                if (o.loaded) holder.style.borderColor = `var(--grey)`;
                if (o.pinned) {
                    holder.style.borderColor = `var(--red)`;
                    drawingctx.beginPath();
                    drawingctx.fillStyle = fetchColor("red");
                    drawingctx.fillRect(0, 0, H/2, H/16);
                    
                    drawingctx.fillStyle = fetchColor("white");
                    drawingctx.font = `${H/16}px Jetbrains Mono`;
                    drawingctx.textAlign = "center";
                    drawingctx.textBaseline = "middle";
                    drawingctx.fillText("Pinned", H/4, H/32, H/2);
                }

                // add the name
                let text = document.createElement("p");
                text.classList.add("saveStateObjectHolderText");
                text.innerText = o.name.length > 20 ? `${o.name.substring(0, 20)}...` : o.name;
                holder.appendChild(text);

                // when clicked, spawn that object in
                holder.addEventListener("click", function(e2) {
                    if (o.type === "token") {
                        let t = new Token(o, true);
                        t.synced = false;
                        t.loaded = false;
                        t.id = Math.floor(Math.random() * 2**31);
                        t.position = {
                            x: psd.cameraLocation.x + (e.clientX - W/2) / psd.cameraLocation.s,
                            y: psd.cameraLocation.y + (e.clientY - H/2) / psd.cameraLocation.s
                        };
                        psd.tokens.push(t);
                        t.sendToken();
                    } else if (o.type === "grid") {
                        let g = new Grid(o, true);
                        g.synced = false;
                        g.loaded = false;
                        g.id = Math.floor(Math.random() * 2**31);
                        g.position = {
                            x: psd.cameraLocation.x + (e.clientX - W/2) / psd.cameraLocation.s,
                            y: psd.cameraLocation.y + (e.clientY - H/2) / psd.cameraLocation.s
                        };
                        psd.grids.push(g);
                        g.sendGrid();
                    }
                    doc.saveStateMenu.classList.add("hidden");
                    psd.currentEditObject = null;
                    psd.inMenu = false;
                });

                // when right clicked, pin it
                holder.addEventListener("contextmenu", function(e2) {
                    o.pinned = !o.pinned;
                    drawingctx.clearRect(0, 0, H/2, H/2);
                    o.render(drawingctx, true, {radius: H/6, x: H/4, y: H/4});
                    holder.style.borderColor = ``;
                    if (o.loaded) holder.style.borderColor = `var(--grey)`;
                    if (o.pinned) {
                        holder.style.borderColor = `var(--red)`;
                        drawingctx.beginPath();
                        drawingctx.fillStyle = fetchColor("red");
                        drawingctx.fillRect(0, 0, H/2, H/16);
                        
                        drawingctx.fillStyle = fetchColor("white");
                        drawingctx.font = `${H/16}px Jetbrains Mono`;
                        drawingctx.textAlign = "center";
                        drawingctx.textBaseline = "middle";
                        drawingctx.fillText("Pinned", H/4, H/32, H/2);
                    }
                    populateRightClick([]);
                    locallySaveObjects();
                });

                document.getElementById("saveStateObjectHoldingMenu").appendChild(holder);
            }
            sendMouseUpdate(e);
        }
    }];

    let found = 0;
    for (let i = psd.grids.length - 1; i >= 0; i--) {
        let grid = psd.grids[i];
        if (!grid.loaded) continue;
        if (grid.inside({
            x: (e.clientX - W/2) / psd.cameraLocation.s + psd.cameraLocation.x,
            y: (e.clientY - H/2) / psd.cameraLocation.s + psd.cameraLocation.y
        })) {
            found++;
            if (found !== psd.clickCombo[0] + 1) continue;

            clickOptions.push({
                name: found === 1 ? `Edit Grid` : `Edit Grid (${grid.name.length > 10 ? `${grid.name.substring(0, 7)}...` : grid.name})`,
                function: function() {
                    Grid.openEditMenu(e, psd.grids[i]);
                }
            });
            break;
        }
    }

    found = 0;
    for (let i = psd.tokens.length - 1; i >= 0; i--) {
        let token = psd.tokens[i];
        if (!token.loaded) continue;
        if (token.checkDrag({
            x: (e.clientX - W/2) / psd.cameraLocation.s + psd.cameraLocation.x,
            y: (e.clientY - H/2) / psd.cameraLocation.s + psd.cameraLocation.y,
        })) {
            found++;
            if (found !== psd.clickCombo[0] + 1) continue;

            clickOptions = [];
            clickOptions.push({
                name: found === 1 ? `Duplicate Token` : `Duplicate Token (${token.name.length > 10 ? `${token.name.substring(0, 7)}...` : token.name})`,
                function: function() {
                    let t = new Token(psd.tokens[i], true);
                    t.synced = false;
                    t.loaded = false;
                    t.id = Math.floor(Math.random() * 2**31);
                    t.position.x += t.radius;
                    t.position.y += t.radius;
                    psd.tokens.push(t);
                    t.sendToken();
                }
            });
            clickOptions.push({
                name: found === 1 ? `Edit Token` : `Edit Token (${token.name.length > 10 ? `${token.name.substring(0, 7)}...` : token.name})`,
                function: function() {
                    Token.openEditMenu(e, psd.tokens[i]);
                }
            });
            clickOptions.push({
                name: found === 1 ? `Delete Token` : `Delete Token (${token.name.length > 10 ? `${token.name.substring(0, 7)}...` : token.name})`,
                function: function() {
                    token.delete();
                }
            });
            break;
        }
    }
    populateRightClick(clickOptions);
});

/* Add menu navigation events to buttons */
function moveHolders(from, to) {
    from.classList.remove("fadeInHolderAnimation");
    from.classList.add("fadeOutHolderAnimation");
    to.classList.remove("fadeOutHolderAnimation", "hidden");
    to.classList.add("fadeInHolderAnimation");
}

// front menu buttons
document.getElementById("frontMainCreateGameButton").addEventListener("click", function(e) {
    moveHolders(document.getElementById("frontMainHolder"), document.getElementById("frontCreateGameHolder"));
});
document.getElementById("frontMainJoinGameButton").addEventListener("click", function(e) {
    moveHolders(document.getElementById("frontMainHolder"), document.getElementById("frontJoinGameHolder"));
});

// create game buttons
document.getElementById("frontCreateGameReturn").addEventListener("click", function(e) {
    moveHolders(document.getElementById("frontCreateGameHolder"), document.getElementById("frontMainHolder"));
});

document.getElementById("frontCreateGameCreateButton").addEventListener("click", function(e) {
    psd.joined = false;
    socket.talk(encodePacket([
        protocol.server.createLobby,
        document.getElementById("frontCreateGameNameInput").value,
        document.getElementById("frontCreateGameCodeInput").value,
        socket.id
    ], ["int8", "string", "string", "float32"]));
});

// join game buttons
document.getElementById("frontJoinGameReturn").addEventListener("click", function(e) {
    moveHolders(document.getElementById("frontJoinGameHolder"), document.getElementById("frontMainHolder"));
});

document.getElementById("frontJoinGameJoinButton").addEventListener("click", function(e) {
    psd.joined = true;
    socket.talk(encodePacket([
        protocol.server.joinLobby,
        document.getElementById("frontJoinGameNameInput").value,
        document.getElementById("frontJoinGameCodeInput").value,
        socket.id
    ], ["int8", "string", "string", "float32"]));
});


// the disconnect prompter, for when a person DCs
document.getElementById("reconnectPrompter").addEventListener("click", function(e) {
    socket.connect();
});

// the token menu remove image button
document.getElementById("tokenRemoveReferenceImageButton").addEventListener("click", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "token") return;
    psd.currentEditObject.removingLinked = true;
    document.getElementById("tokenImageFileDropLabel").innerText = "Click to Upload a File";
    document.getElementById("tokenImageFileDrop").value = "";
});

document.getElementById("tokenImageFileDrop").addEventListener("change", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "token") return;
    const token = psd.currentEditObject;
    if (document.getElementById("tokenImageFileDrop").files.length > 0) {
        const reader = new FileReader();
        reader.onload = function() {
            const img = new SavedImage({
                data: reader.result,
                name: document.getElementById("tokenImageFileDrop").files[0].name
            });
            token.tempImage = img;
        };
        reader.readAsDataURL(document.getElementById("tokenImageFileDrop").files[0]);
    }
});

// the grid menu remove image button
document.getElementById("gridRemoveReferenceImageButton").addEventListener("click", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "grid") return;
    psd.currentEditObject.removingLinked = true;
    document.getElementById("gridImageFileDropLabel").innerText = "Click to Upload a File";
    document.getElementById("gridImageFileDrop").value = "";
});

// the button to delete a token from reality
document.getElementById("deleteTokenButton").addEventListener("click", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "token") return;
    psd.currentEditObject.delete();
    psd.inMenu = false;
    psd.currentEditObject = null;
    doc.tokenDataMenu.classList.add("hidden");
    sendMouseUpdate(e);
});

// the button to delete a grid from reality
document.getElementById("deleteGridButton").addEventListener("click", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "grid") return;
    psd.currentEditObject.delete();
    psd.inMenu = false;
    psd.currentEditObject = null;
    doc.gridDataMenu.classList.add("hidden");
    sendMouseUpdate(e);
});

// export the map into a kmap file and store it away
function exportMapData(onlyPinned = false) {
    // organize our data
    let data = {
        requiredImages: [],
        requiredTokens: [],
        requiredGrids: [],
    };
    for (let t of psd.tokens) {
        if (!t.loaded && !onlyPinned) continue;
        if (onlyPinned && !t.pinned) continue;
        if (t.linkedImage !== null) data.requiredImages.push({
            type: t.linkedImage.type,
            id: t.linkedImage.id,
            name: t.linkedImage.name,
            data: t.linkedImage.data
        });
        data.requiredTokens.push({
            type: t.type,
            id: t.id,
            name: t.name,
            description: t.description,
            radius: t.radius,
            position: t.position,
            originalPosition: t.position,
            snapInterval: t.snapInterval ? 1 : 0,
            shape: t.shape,
            cropImage: t.cropImage,
            baseColor: t.baseColor,
            lineColor: t.lineColor,
            lineWidth: t.lineWidth ,
            zIndex: t.zIndex,
            linkedSheetAwait: t.linkedSheet === null ? {id: -1, name: ""} : {id: t.linkedSheet.id, name: t.linkedSheet.name},
            linkedImageAwait: t.linkedImage === null ? {id: -1, name: ""} : {id: t.linkedImage.id, name: t.linkedImage.name},
            synced: true,
        });
    }
    for (let g of psd.grids) {
        if (!g.loaded && !onlyPinned) continue;
        if (onlyPinned && !g.pinned) continue;
        if (g.linkedImage !== null) data.requiredImages.push({
            type: g.linkedImage.type,
            id: g.linkedImage.id,
            name: g.linkedImage.name,
            data: g.linkedImage.data
        });
        data.requiredGrids.push({
            type: g.type,
            id: g.id,
            name: g.name,
            radius: g.radius,
            dim: g.dim,
            position: g.position,
            realDim: g.realDim,
            shape: g.shape,
            lineColor: g.lineColor,
            lineWidth: g.lineWidth,
            zIndex: g.zIndex,
            enableGridCount: g.enableGridCount,
            linkedImage: g.linkedImage,
            linkedImageAwait: g.linkedImage === null ? {id: -1, name: ""} : {id: g.linkedImage.id, name: g.linkedImage.name},
            synced: true,
        });
    }

    psd.unsavedChange = true;

    data = JSON.stringify(data);
    return data;
}
document.getElementById("exportMapButton").addEventListener("click", function(e) {
    let data = exportMapData();
    
    const blob = new Blob([data], { type: "text/plain" });
    const fileURL = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = fileURL;
    downloadLink.download = "unnamed.kmap";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    URL.revokeObjectURL(fileURL);
});

// imports a map from a kmap file
function importFromData(data, talkToServer = true) {
    for (let t of psd.tokens) t.loaded = false;
    for (let g of psd.grids) g.loaded = false;
    if (talkToServer) socket.talk(encodePacket([protocol.server.loadNewMap], ["int8"]));

    for (let image of data.requiredImages) {
        if (findAsset(image.id, image.name) !== null) continue;
        psd.images.push(new SavedImage(image));
    }

    for (let t of data.requiredTokens) {
        let a = findAsset(t.id, t.name);
        if (a !== null) psd.tokens.splice(psd.tokens.indexOf(a), 1);
        a = new Token(t);
        if (a.linkedImageAwait.id !== -1) for (let image of psd.images) {
            if (a.linkedImageAwait.id === image.id && a.linkedImageAwait.name === image.name) a.linkedImage = image;
        }
        if (a.linkedSheetAwait.id !== -1) for (let sheet of psd.sheets) {
            if (a.linkedSheetAwait.id === sheet.id && a.linkedSheetAwait.name === sheet.name) a.linkedSheet = sheet;
        }
        psd.tokens.push(a);
        
        if (talkToServer) {
            a.loaded = true;
            a.sendToken();
        }
    }

    for (let g of data.requiredGrids) {
        let a = findAsset(g.id, g.name);
        if (a !== null) psd.grids.splice(psd.grids.indexOf(a), 1);
        a = new Grid(g);
        if (a.linkedImageAwait.id !== -1) for (let image of psd.images) {
            if (a.linkedImageAwait.id === image.id && a.linkedImageAwait.name === image.name) a.linkedImage = image;
        }
        psd.grids.push(a);
        
        if (talkToServer) {
            a.loaded = true;
            a.sendGrid();
        }
    }
}
document.getElementById("importMapFileDrop").addEventListener("change", function(e) {
    if (!psd.isHost) {
        alert("You must be host to import a map");
        return;
    }
    if (document.getElementById("importMapFileDrop").files.length > 0) {
        const reader = new FileReader();
        reader.onload = function() {
            try {
                doc.saveStateMenu.classList.add("hidden");
                psd.currentEditObject = null;
                psd.inMenu = false;
                const data = JSON.parse(atob(reader.result.split("base64,")[1]));
                importFromData(data);
            } catch(err) {
                alert("The uploaded file is invalid");
                console.log(err);
            }
        };
        reader.readAsDataURL(document.getElementById("importMapFileDrop").files[0]);
    }
});

document.getElementById("wipeSaveStatesButton").addEventListener("click", function(e) {
    createPopup(
        "Confirm Wipe", `This will delete all (unpinned and unloaded) saved tokens and grids. Are you sure you want to do this?`, {type: 0},
        "Confirm", function(e) {
            for (let i = psd.tokens.length - 1; i >= 0; i--) {
                if (psd.tokens[i].pinned || psd.tokens[i].loaded) continue;
                psd.tokens.splice(i, 1);
            }
            for (let i = psd.grids.length - 1; i >= 0; i--) {
                if (psd.grids[i].pinned || psd.grids[i].loaded) continue;
                psd.grids.splice(i, 1);
            }
            doc.saveStateMenu.classList.add("hidden");
            psd.currentEditObject = null;
            psd.inMenu = false;
            return true;
        },
        "Cancel", function(e) {
            return true;
        },
    );
});

// a function that checks what objects exist in our scene, and saves them on refresh
function locallySaveObjects() {
    let data = exportMapData(true);
    try {
        localStorage.setItem("localObjectSaves", data);
    } catch(err) {
        alert(err);
    }
}
if (localStorage.getItem("localObjectSaves")) {
    try {
        let data = JSON.parse(localStorage.getItem("localObjectSaves"));
        importFromData(data, false);
        for (let token of psd.tokens) token.pinned = true;
        for (let grid of psd.grids) grid.pinned = true;
    } catch (err) {
        console.log(err);
        localStorage.setItem("localObjectSaves", "");
    }
}

/* Load saved input contents */
function saveInput(input) {
    input.addEventListener("change", function(e) {
        localStorage.setItem(input.id, input.value);
    });
    if (localStorage.getItem(input.id)) input.value = localStorage.getItem(input.id);
}

saveInput(document.getElementById("frontCreateGameNameInput"));
saveInput(document.getElementById("frontCreateGameCodeInput"));

saveInput(document.getElementById("frontJoinGameNameInput"));
saveInput(document.getElementById("frontJoinGameCodeInput"));

// our key controls
document.addEventListener("keydown", function(e) {
    switch (e.key) {
        case "r": {
            if (e.ctrlKey) return;
            if (socket.inLobby && !psd.inMenu) socket.talk(encodePacket([protocol.server.sceneSanityCheck], ["int8"]));
            break;
        }
    }
});

// when the page is reloaded, if we haven't recently saved ask if we are sure
window.addEventListener("beforeunload", function(e) {
    if (psd.unsavedChanges) e.preventDefault();
});


// an update loop to keep the game running
function update() {
    // check if we have assets for our images that are missing them
    for (let token of psd.tokens) {
        if (token.linkedImage !== null || token.linkedImageAwait.id === -1) continue;
        for (let image of psd.images) {
            if (image.type !== "image") continue;
            if (image.id !== token.linkedImageAwait.id || image.name !== token.linkedImageAwait.name) continue;
            token.linkedImage = image;
        }
    }
    for (let grid of psd.grids) {
        if (grid.linkedImage !== null || grid.linkedImageAwait.id === -1) continue;
        for (let image of psd.images) {
            if (image.type !== "image") continue;
            if (image.id !== grid.linkedImageAwait.id || image.name !== grid.linkedImageAwait.name) continue;
            grid.linkedImage = image;
        }
    }

    // begin rendering
    mctx.clearRect(0, 0, W, H);

    mctx.beginPath();
    mctx.fillStyle = fetchColor("red");
    mctx.arc(
            (-psd.cameraLocation.x) * psd.cameraLocation.s + W/2,
            (-psd.cameraLocation.y) * psd.cameraLocation.s + H/2,
            3 * psd.cameraLocation.s, 0, Math.PI * 2
    );
    mctx.fill();

    // draw every grid by their z-index
    psd.grids = psd.grids.sort(function(a, b) {
        return a.zIndex - b.zIndex;
    });
    for (let grid of psd.grids) {
        if (!grid.loaded) continue;
        grid.render();
    }

    // draw every token by their z-index
    psd.tokens = psd.tokens.sort(function(a, b) {
        return a.zIndex - b.zIndex;
    });
    for (let token of psd.tokens) {
        if (!token.loaded) continue;
        token.render();
    }

    // finally, draw player's mouses over everything
    for (let player of psd.players) {
        player.lerpPosition();
        player.renderMouse();
    }
    for (let i = psd.players.length - 1; i >= 0; i--) {
        if (new Date().getTime() - psd.players[i].tick > 1000) psd.players.splice(i, 1);
    }

    // if we have the token or grid edit menus up, draw the previews for those
    if (psd.inMenu && psd.currentEditObject !== null) switch (psd.currentEditObject.type) {
        case "token": {
            let drawing = document.getElementById("tokenShowcaseView");
            drawing.width = H/2;
            drawing.height = H/2;
            let drawingctx = drawing.getContext("2d");
            drawingctx.clearRect(0, 0, W/2, H/2);
            
            psd.currentEditObject.render(drawingctx, true, {
                radius: H/6,
                x: H/4,
                y: H/4,
                tokenRadius: sanitize(document.getElementById("tokenRadiusInput").value, "float", {min: 1, max: 1000, default: 20}),
                lineColor: sanitize(document.getElementById("tokenBorderColorInput").value, "color", {default: "white"}),
                baseColor: sanitize(document.getElementById("tokenColorInput").value, "color", {default: "red"}),
                shape: sanitize(document.getElementById("tokenShapeInput").value, "option", {valid: ["circle", "square"], default: "circle"}),
                lineWidth: sanitize(document.getElementById("tokenBorderRadiusInput").value, "float", {min: 0, max: 1000, default: 5}),
                linkedImage: psd.currentEditObject.tempImage,
            });
            break;
        }
        case "grid": {
            break;
        }
    }

    requestAnimationFrame(update);
}
requestAnimationFrame(update);

// for our render hosting, we need to do this to keep the project active
function pingRender() {
    let pingsocket = new Socket();
    pingsocket.pingsocket = true;
    pingsocket.connect();
    setTimeout(function(e) {
        pingsocket.disconnect();
        pingsocket = null;
    }, 1000);
}
setInterval(pingRender, 5 * 60 * 1000);