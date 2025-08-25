import { decodePacket, encodePacket } from "./clientProtocol.js";
import { doc, createPopup, findAsset, psd, preferences, populateRightClick, randomColor } from "./sheetScripts.js";
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

let ctx = doc.gameCanvas.getContext("2d");
ctx.lineCap = "round";
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
        this.snapInterval = p.snapInterval ?? 1;

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

        this.grabbingPlayer = p.grabbingPlayer ?? null;
        this.preventDefaultPosition = false;
        this.synced = p.synced ?? false;
        this.loaded = p.loaded ?? false;
        if (this.synced || waitSync) return;

        this.sendToken();
    }

    // unloads a token and tells the server to drop it
    delete() {
        this.loaded = false;
        socket.talk(encodePacket([protocol.server.deleteObject, this.id, this.name], ["int8", "int32", "string"]));
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
            /* 14 */ this.linkedSheet ? this.linkedSheet.id : -1, "int32",
            /* 15 */ this.linkedSheet ? this.linkedSheet.name : "", "string",
            /* 16 */ this.linkedImage ? this.linkedImage.id : -1, "int32",
            /* 17 */ this.linkedImage ? this.linkedImage.name : "", "string",
            /* 18 */ oldid ?? this.id, "int32"
        ];
        const tokenData = tokenLayout.filter((e, i) => {return i % 2 === 0});
        const tokenTypes = tokenLayout.filter((e, i) => {return i % 2 === 1});
        socket.talk(encodePacket(tokenData, tokenTypes));

        // if the server doesn't have the image asset, send it over
        if (this.linkedImage) {
            socket.talk(encodePacket([protocol.server.assetInquiry, this.linkedImage.id, this.linkedImage.name], ["int8", "int32", "string"]));
        }
    }

    render() {
        ctx.save();
        if (!this.synced) ctx.globalAlpha = 0.4;
        //if (this.preventDefaultPosition) ctx.globalAlpha = 0.7;
        ctx.translate(
            (this.position.x - psd.cameraLocation.x) * psd.cameraLocation.s + W/2,
            (this.position.y - psd.cameraLocation.y) * psd.cameraLocation.s + H/2
        );
        
        ctx.lineWidth = this.lineWidth * psd.cameraLocation.s;

        // draw the color of the grabber in the background if needed
        if (this.grabbingPlayer !== null) {
            let grabber = "red";
            for (let player of psd.players) if (player.id === this.grabbingPlayer) grabber = player.mouseColor;
            ctx.beginPath();
            ctx.fillStyle = fetchColor(grabber);
            ctx.strokeStyle = fetchColor(grabber);
            ctx.arc(0, 0, this.radius * psd.cameraLocation.s, 0, Math.PI * 2);
            ctx.fill();
            if (this.lineWidth > 0) ctx.stroke();
        }

        // draw the base token
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * psd.cameraLocation.s * (this.grabbingPlayer === null ? 1 : 0.7), 0, Math.PI * 2);
        ctx.fillStyle = fetchColor(this.baseColor);
        ctx.strokeStyle = fetchColor(this.lineColor);
        ctx.fill();
        if (this.lineWidth > 0) ctx.stroke();

        // draw the linked image, if one exists
        if (this.linkedImage && this.linkedImage.drawableObject.complete) {
            buildctx.clearRect(0, 0, W, H);
            buildctx.beginPath();
            buildctx.arc(this.radius * psd.cameraLocation.s, this.radius * psd.cameraLocation.s, this.radius * psd.cameraLocation.s, 0, Math.PI * 2);
            buildctx.fill();
            buildctx.globalCompositeOperation = "source-in";
            buildctx.drawImage(this.linkedImage.drawableObject, 0, 0, this.radius * 2 * psd.cameraLocation.s, this.radius * 2 * psd.cameraLocation.s);
            buildctx.globalCompositeOperation = "source-over";

            ctx.drawImage(buildCanvas, -this.radius * psd.cameraLocation.s, -this.radius * psd.cameraLocation.s);
        }
        ctx.restore();
    }

    // takes in a location, and returns true if the token hitbox is within that location
    checkDrag(loc) {
        switch (this.shape) {
            case "circle": {
                return ((this.position.x - loc.x) ** 2 + (this.position.y - loc.y) ** 2) <= this.radius ** 2;
            }
        }
    }

    // when a user clicks a token, go through this to tell if it is being dragged or selected
    clicked(e) {
        const token = this;
        token.originalPosition = {x: token.position.x, y: token.position.y};
        token.preventDefaultPosition = true;

        // as we drag, move the token accordingly
        function moveToken(e2) {
            if (!token.preventDefaultPosition) {
                mouseUp(e2);
                return;
            }
            token.position.x = token.originalPosition.x - (e.clientX - e2.clientX) / psd.cameraLocation.s;
            token.position.y = token.originalPosition.y - (e.clientY - e2.clientY) / psd.cameraLocation.s;
            // snap it to the interval
            token.position.x = Math.round(token.position.x / token.snapInterval) * token.snapInterval;
            token.position.y = Math.round(token.position.y / token.snapInterval) * token.snapInterval;

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
        document.getElementById("tokenGridSnapInput").value = this.snapInterval;
        document.getElementById("tokenColorInput").value = this.baseColor;
        document.getElementById("tokenBorderColorInput").value = this.lineColor;
        document.getElementById("tokenShapeInput").value = this.shape;
        document.getElementById("tokenImageFileDrop").value = "";
        document.getElementById("tokenImageFileDropLabel").innerText = this.linkedImage ? this.linkedImage.name : "Click to Upload a File";
    }

    // uses the update menu's data to update this token
    extractFromTokenMenu() {
        let clone = new Token(this);
        clone.loaded = false;
        psd.tokens.push(clone);
        
        this.id = Math.floor(Math.random() * 2**31);
        this.name = sanitize(document.getElementById("tokenNameInput").value, "string", {max: 32, default: "Unnamed Token"});
        this.description = sanitize(document.getElementById("tokenDescriptionInput").value, "string", {max: 1000, default: ""});
        this.radius = sanitize(document.getElementById("tokenRadiusInput").value, "float", {min: 1, max: 1000, default: 20});
        this.lineWidth = sanitize(document.getElementById("tokenBorderRadiusInput").value, "float", {min: 0, max: 1000, default: 5});
        this.zIndex = sanitize(document.getElementById("tokenZIndexInput").value, "float", {min: -1000, max: 1000, default: 0});
        this.snapInterval = sanitize(document.getElementById("tokenGridSnapInput").value, "float", {min: 0.1, max: 1000, default: 1});
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
    constructor(p) {
        this.type = p.type ?? "grid";
        this.id = p.id ?? Math.floor(Math.random() * 2**31);

        this.name = p.name ?? "Unnamed Grid";

        this.radius = p.radius ?? 50;
        this.dim = p.dim ?? {x: 10, y: 10};
        this.position = p.position ?? {x: 0, y: 0};
        this.realDim = p.realDim ?? {x: this.radius * this.dim.x, y: this.radius * this.dim.y};

        this.shape = p.shape ?? "square";
        this.lineColor = p.lineColor ?? "red";
        this.lineWidth = p.lineWidth ?? 2;
        this.zIndex = p.zIndex ?? -1;

        this.linkedImage = p.linkedImage ?? null;
        this.linkedImageAwait = p.linkedImageAwait ?? {id: -1, name: ""};

        this.synced = p.synced ?? false;
        this.loaded = p.loaded ?? false;
        if (this.synced) return;

        this.sendGrid();
    }

    // unloads a grid and tells the server to drop it
    delete() {
        this.loaded = false;
        socket.talk(encodePacket([protocol.server.deleteObject, this.id, this.name], ["int8", "int32", "string"]));
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

    render() {
        this.realDim = {x: this.radius * this.dim.x, y: this.radius * this.dim.y};
        
        ctx.beginPath();
        ctx.save();
        ctx.translate(
            (this.position.x - psd.cameraLocation.x) * psd.cameraLocation.s + W/2,
            (this.position.y - psd.cameraLocation.y) * psd.cameraLocation.s + H/2
        );
        ctx.translate(-(this.radius * this.dim.x / 2) * psd.cameraLocation.s, -(this.radius * this.dim.y / 2) * psd.cameraLocation.s);
        ctx.strokeStyle = fetchColor(this.lineColor);
        ctx.lineWidth = this.lineWidth * psd.cameraLocation.s;
        
        // draw the linked image, if one exists
        if (this.linkedImage && this.linkedImage.drawableObject.complete) {
            ctx.beginPath();
            let ratio = this.linkedImage.drawableObject.height / this.linkedImage.drawableObject.width;
            ctx.drawImage(this.linkedImage.drawableObject, 0, 0, this.realDim.x * psd.cameraLocation.s, this.realDim.x * psd.cameraLocation.s * ratio);
        }
        
        switch (this.shape) {
            case "square": {
                for (let i = 0; i < this.dim.x + 1; i++) {
                    ctx.moveTo(this.radius * i * psd.cameraLocation.s, 0);
                    ctx.lineTo(this.radius * i * psd.cameraLocation.s, this.radius * this.dim.y * psd.cameraLocation.s);
                }
                for (let i = 0; i < this.dim.y + 1; i++) {
                    ctx.moveTo(0, this.radius * i * psd.cameraLocation.s);
                    ctx.lineTo(this.radius * this.dim.x * psd.cameraLocation.s, this.radius * i * psd.cameraLocation.s);
                }
                if (this.lineWidth > 0) ctx.stroke();
                break;
            }
            case "hex": {
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
        document.getElementById("gridShapeInput").value = this.shape;
        document.getElementById("gridImageFileDrop").value = "";
        document.getElementById("gridImageFileDropLabel").innerText = this.linkedImage ? this.linkedImage.name : "Click to Upload a File";
    }

    // uses the update menu's data to update this token
    extractFromGridMenu() {
        let clone = new Grid(this);
        clone.loaded = false;
        psd.grids.push(clone);
        
        this.id = Math.floor(Math.random() * 2**31);
        this.name = sanitize(document.getElementById("gridNameInput").value, "string", {max: 32, default: "Unnamed Grid"});
        this.radius = sanitize(document.getElementById("gridRadiusInput").value, "float", {min: 1, max: 1000, default: 50});
        this.dim.x = sanitize(document.getElementById("gridXDimInput").value, "float", {min: 1, max: 1000, default: 10});
        this.dim.y = sanitize(document.getElementById("gridYDimInput").value, "float", {min: 1, max: 1000, default: 10});
        this.position.x = sanitize(document.getElementById("gridXPosInput").value, "float", {min: -1000000, max: 1000000, default: 0});
        this.position.y = sanitize(document.getElementById("gridYPosInput").value, "float", {min: -1000000, max: 1000000, default: 0});
        this.lineWidth = sanitize(document.getElementById("gridLineWidthInput").value, "float", {min: 0, max: 1000, default: 2});
        this.lineColor = sanitize(document.getElementById("gridLineColorInput").value, "color", {default: "white"});
        this.zIndex = sanitize(document.getElementById("gridZIndexInput").value, "float", {min: -1000, max: 1000, default: 0});
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

    renderMouse() {
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
    }

    connect() {
        if (this.socket !== null) return;
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
                "Ok", function(e) {
                    document.getElementById("simulatorMenu").classList.add("hidden");
                    document.getElementById("frontMenu").classList.remove("hidden");
                    socket.inLobby = false;
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
                    "repeat", 'string', 'int32', 'string', 'string', 'float32', 'float32', 'float32', 'string', 'int8', 'string', 'string', 'float32', 'int32', 'int32', 'string', 'int32', 'string', "int32", "end",
                    "repeat", "string", "int32", "string", "float32", "float32", "float32", "float32", "float32", "string", "string", "float32", "int32", "int32", "string", "int32", "end"
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
                for (let i = 0; i < d[2].length; i += 18) {
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
                        linkedSheetAwait: {id: d[2][i + 13], name: d[2][i + 14]},
                        linkedImageAwait: {id: d[2][i + 15], name: d[2][i + 16]},
                        grabbingPlayer: d[2][i + 17] === -1 ? null : d[2][i + 17],
                        synced: true,
                    }));
                }
                for (let i = 0; i < d[3].length; i += 14) {
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
                        linkedImageAwait: {id: d[3][i + 12], name: d[3][i + 13]},
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
            sendMouseUpdate(e);
        }
    }];
    for (let grid of psd.grids) {
        if (!grid.loaded) continue;
        if (grid.inside({x: e.clientX + psd.cameraLocation.x - W/2, y: e.clientY + psd.cameraLocation.y - H/2})) {
            clickOptions.push({
                name: "Edit Grid",
                function: function() {
                    Grid.openEditMenu(e, grid);
                }
            });
            break;
        }
    }
    for (let token of psd.tokens) {
        if (!token.loaded) continue;
        if (token.checkDrag({
            x: (e.clientX - W/2) / psd.cameraLocation.s + psd.cameraLocation.x,
            y: (e.clientY - H/2) / psd.cameraLocation.s + psd.cameraLocation.y,
        })) {
            clickOptions = [];
            clickOptions.push({
                name: "Duplicate Token",
                function: function() {
                    let t = new Token(token, true);
                    t.synced = false;
                    t.loaded = false;
                    t.id = Math.floor(Math.random() * 2**31);
                    t.color = randomColor();
                    t.position.x += t.radius;
                    t.position.y += t.radius;
                    psd.tokens.push(t);
                    t.sendToken();
                }
            });
            clickOptions.push({
                name: "Edit Token",
                function: function() {
                    Token.openEditMenu(e, token);
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
    socket.talk(encodePacket([
        protocol.server.createLobby,
        document.getElementById("frontCreateGameNameInput").value,
        document.getElementById("frontCreateGameCodeInput").value,
    ], ["int8", "string", "string"]));
});

// join game buttons
document.getElementById("frontJoinGameReturn").addEventListener("click", function(e) {
    moveHolders(document.getElementById("frontJoinGameHolder"), document.getElementById("frontMainHolder"));
});

document.getElementById("frontJoinGameJoinButton").addEventListener("click", function(e) {
    socket.talk(encodePacket([
        protocol.server.joinLobby,
        document.getElementById("frontJoinGameNameInput").value,
        document.getElementById("frontJoinGameCodeInput").value,
    ], ["int8", "string", "string"]));
});


// the disconnect prompter, for when a person DCs
document.getElementById("reconnectPrompter").addEventListener("click", function(e) {
    socket.connect();
});

// the token menu remove image button
document.getElementById("tokenRemoveReferenceImageButton").addEventListener("click", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "token") return;
    psd.currentEditObject.linkedImage = null;
    document.getElementById("tokenImageFileDropLabel").innerText = "Click to Upload a File";
    document.getElementById("tokenImageFileDrop").value = "";
});

// the grid menu remove image button
document.getElementById("gridRemoveReferenceImageButton").addEventListener("click", function(e) {
    if (psd.currentEditObject === null || psd.currentEditObject.type !== "grid") return;
    psd.currentEditObject.linkedImage = null;
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
document.getElementById("exportMapButton").addEventListener("click", function(e) {
    // organize our data
    let data = {
        requiredImages: [],
        requiredTokens: [],
        requiredGrids: [],
    };
    for (let t of psd.tokens) {
        if (!t.loaded) continue;
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
            snapInterval: t.snapInterval,
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
        if (!g.loaded) continue;
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
            linkedImage: g.linkedImage,
            linkedImageAwait: g.linkedImage === null ? {id: -1, name: ""} : {id: g.linkedImage.id, name: g.linkedImage.name},
            synced: true,
        });
    }

    data = JSON.stringify(data);
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
document.getElementById("importMapFileDrop").addEventListener("change", function(e) {
    if (!psd.isHost) {
        alert("You must be host to import a map");
        return;
    }
    if (document.getElementById("importMapFileDrop").files.length > 0) {
        const reader = new FileReader();
        reader.onload = function() {
            try {
                const data = JSON.parse(atob(reader.result.split("base64,")[1]));

                for (let t of psd.tokens) t.loaded = false;
                for (let g of psd.grids) g.loaded = false;
                socket.talk(encodePacket([protocol.server.loadNewMap], ["int8"]));

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
                    
                    a.loaded = true;
                    a.sendToken();
                }

                for (let g of data.requiredGrids) {
                    let a = findAsset(g.id, g.name);
                    if (a !== null) psd.grids.splice(psd.grids.indexOf(a), 1);
                    a = new Grid(g);
                    if (a.linkedImageAwait.id !== -1) for (let image of psd.images) {
                        if (a.linkedImageAwait.id === image.id && a.linkedImageAwait.name === image.name) a.linkedImage = image;
                    }
                    psd.grids.push(a);
                    
                    a.loaded = true;
                    a.sendGrid();
                }
                console.log("donsies")
            } catch(err) {
                alert("The uploaded file is invalid");
                console.log(err);
            }
        };
        reader.readAsDataURL(document.getElementById("importMapFileDrop").files[0]);
    }
});

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
    ctx.clearRect(0, 0, W, H);

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
        ctx.globalAlpha = 1;
    }

    // finally, draw player's mouses over everything
    for (let player of psd.players) {
        player.lerpPosition();
        player.renderMouse();
    }
    for (let i = psd.players.length - 1; i >= 0; i--) {
        if (new Date().getTime() - psd.players[i].tick > 1000) psd.players.splice(i, 1);
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