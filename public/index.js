import { decodePacket, encodePacket } from "./clientProtocol.js";
import { doc, createPopup, savedAssets, findAsset, playerStateData, preferences, populateRightClick, randomColor } from "./sheetScripts.js";

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
    constructor(p) {
        this.type = p.type ?? "token";

        this.name = p.name ?? "Unnamed Token";
        this.description = p.description ?? "";

        this.radius = p.radius ?? 20;
        this.position = p.position ?? {x: 0, y: 0};

        this.shape = p.shape ?? "circle";
        this.cropImage = p.cropImage ?? true;
        this.baseColor = p.baseColor ?? "red";
        this.lineColor = p.lineColor ?? "white";
        this.lineWidth = p.lineWidth ?? 5;
        this.zIndex = p.zIndex ?? 0;

        this.linkedSheet = p.linkedSheet ?? null;
        this.linkedImage = p.linkedImage ?? null;

        //socket.talk(encodePacket([protocol.server.tokenCreated, ], ["int8"]))
    }

    render() {
        ctx.beginPath();
        ctx.save();
        ctx.translate(this.position.x - playerStateData.cameraLocation.x + W/2, this.position.y - playerStateData.cameraLocation.y + H/2);
        ctx.arc(
            0,
            0,
            this.radius, 0, Math.PI * 2
        );
        ctx.fillStyle = fetchColor(this.baseColor);
        ctx.strokeStyle = fetchColor(this.lineColor);
        ctx.lineWidth = this.lineWidth;
        ctx.fill();
        ctx.stroke();

        // draw the linked image, if one exists
        if (this.linkedImage.drawableObject.complete) {
            buildctx.clearRect(0, 0, W, H);
            buildctx.beginPath();
            buildctx.arc(this.radius, this.radius, this.radius, 0, Math.PI * 2);
            buildctx.fill();
            buildctx.globalCompositeOperation = "source-in";
            buildctx.drawImage(this.linkedImage.drawableObject, 0, 0, this.radius * 2, this.radius * 2);
            buildctx.globalCompositeOperation = "source-over";

            ctx.drawImage(buildCanvas, -this.radius, -this.radius);
        }
        ctx.restore();
    }
}

class PlayerState {
    constructor(p) {
        this.id = p.id;
        this.mouseLocation = p.mouseLocation ?? {x: 0, y: 0};
        this.realMouseLocation = p.mouseLocation ?? {x: 0, y: 0};
        this.mouseColor = p.mouseColor ?? "red";
    }

    lerpPosition() {
        this.mouseLocation.x = lerp(this.mouseLocation.x, this.realMouseLocation.x, 0.6);
        this.mouseLocation.y = lerp(this.mouseLocation.y, this.realMouseLocation.y, 0.6);
    }

    renderMouse() {
        ctx.beginPath();
        ctx.arc(
            this.mouseLocation.x - playerStateData.cameraLocation.x + W/2,
            this.mouseLocation.y - playerStateData.cameraLocation.y + H/2,
            10, 0, Math.PI * 2
        );
        ctx.fillStyle = fetchColor(this.mouseColor);
        ctx.fill();
    }
}

//_ Canvas Drawing Functions
function drawGrid(p = {}) {
    ctx.beginPath();
    ctx.strokeStyle = fetchColor(p.color);
    ctx.lineWidth = p.lineWidth;
    switch (p.shape) {
        case "square": {
            ctx.save();
            ctx.translate(p.origin.x - p.radius * p.dim.x / 2, p.origin.y - p.radius * p.dim.y / 2);
            for (let i = 0; i < p.dim.x + 1; i++) {
                ctx.moveTo(p.radius * i, 0);
                ctx.lineTo(p.radius * i, p.radius * p.dim.y);
            }
            for (let i = 0; i < p.dim.y + 1; i++) {
                ctx.moveTo(0, p.radius * i);
                ctx.lineTo(p.radius * p.dim.x, p.radius * i);
            }
            ctx.stroke();
            ctx.restore();
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
    ctx.strokeStyle = fetchColor("lightBlue");
    ctx.beginPath();
    ctx.arc(W/2, H/2, 20, 0, Math.PI * 2);
    ctx.stroke();
}

// our websocket connection
class Socket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.inLobby = false;
    }

    connect() {
        if (this.socket !== null) return;
        document.getElementById("reconnectPrompter").classList.remove("hidden");
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
        document.getElementById("reconnectPrompter").classList.remove("hidden");
        if (this.inLobby) {
            console.log("Connection Lost");
            createPopup(
                "Connection Lost", `You have been disconnected from this lobby due to problems on the server-side. All assets and maps have been automatically saved, and you will be brought back to the main menu.`, {type: 0},
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
                playerStateData.myId = d[2];
                console.log(`Successfully connected to lobby with code ${d[1]}.`);
                //! Use this only when an asset is required, like a token is loaded in
                /*socket.talk(encodePacket(
                    [protocol.server.uploadRequiredAssets, 1, savedAssets[1].id, savedAssets[1].name, savedAssets[1].data, 0],
                    ["int8", "repeat", "int32", "string", "string", "end"]
                ));*/
                break;
            }
            // the server is asking if we own the needed assets and if we don't own any, we request them
            case protocol.client.assetInquiryPacket: {
                const d = decodePacket(reader, ["int8", "repeat", "int32", "string", "end"]);
                let requestedAssets = [protocol.server.requestedAssets, 0];
                for (let i = 0; i < d[1].length; i += 2) {
                    if (findAsset(d[1][i + 0], d[1][i + 1]) === null) {
                        requestedAssets.push(d[1][i + 0], d[1][i + 1]);
                        requestedAssets[1]++;
                    }
                }
                requestedAssets.push(0);
                socket.talk(encodePacket(requestedAssets, ["int8", "repeat", "int32", "string", "end"]));
                document.getElementById("loadingScreen").classList.remove("hidden");
                break;
            }
            // when the server sends us our requested assets, save them to our asset storage
            case protocol.client.assetDataPacket: {
                const d = decodePacket(reader, ["int8", "repeat", "int32", "string", "string", "end"]);
                console.log("Data packet recieved!");
                for (let i = 0; i < d[1].length; i += 3) {
                    if (findAsset(d[1][i + 0], d[1][i + 1]) !== null) continue;
                    savedAssets.push(new SavedImage({
                        id: d[1][i + 0],
                        name: d[1][i + 1],
                        data: d[1][i + 2],
                    }));
                }
                document.getElementById("loadingScreen").classList.add("hidden");
                break;
            }
            // when we get a basic update, extract everything and update stuff
            case protocol.client.basicUpdate: {
                const d = decodePacket(reader, ["int8", "repeat", "int32", "float32", "float32", "string", "end"]);
                //console.log(d[1]);
                for (let i = 0; i < d[1].length; i += 4) {
                    let other = null;
                    for (let player of playerStateData.players) if (player.id === d[1][i + 0]) {other = player; break;}
                    if (other === null) {
                        other = new PlayerState({
                            id: d[1][i + 0],
                            mouseLocation: {x: d[1][i + 1], y: d[1][i + 2]},
                            mouseColor: d[1][i + 3]
                        });
                        playerStateData.players.push(other);
                    }
                    other.realMouseLocation = {x: d[1][i + 1], y: d[1][i + 2]};
                    other.mouseColor = d[1][i + 3];
                }
                break;
            }
            default: {
                console.warn(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                break;
            }
        }
    }

    open() {
        console.log("Socket connected");
    }

    error(error) {
        console.error(error);
    }

    close(reason) {
        console.log(`Socket closed for reason:`);
        console.log(reason)
        this.disconnect();
    }
}

socket = new Socket();
socket.connect();
document.getElementById("loadingScreen").classList.add("hidden");

// when dragging across the canvas, change the camera position
doc.gameCanvas.addEventListener("mousedown", function(e) {
    playerStateData.originalCameraLocation = structuredClone(playerStateData.cameraLocation);
    function drag(e2) {
        playerStateData.cameraLocation.x = playerStateData.originalCameraLocation.x + e.clientX - e2.clientX;
        playerStateData.cameraLocation.y = playerStateData.originalCameraLocation.y + e.clientY - e2.clientY;
    }
    function release(e2) {
        document.removeEventListener("mousemove", drag);
        document.removeEventListener("mouseup", release);
    }
    
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", release);
});

// when the mouse moves, update the server with this info
doc.gameCanvas.addEventListener("mousemove", function(e) {
    if (!socket.inLobby) return;
    playerStateData.mousePosition = {x: e.clientX, y: e.clientY};
    socket.talk(encodePacket([
        protocol.server.mouseMoveData,
        playerStateData.cameraLocation.x,
        playerStateData.cameraLocation.y,
        playerStateData.mousePosition.x - W/2,
        playerStateData.mousePosition.y - H/2,
        preferences.mouseColor,
    ], ["int8", "float32", "float32", "float32", "float32", "string"]));
});

/* Sense where a player right clicks, and add menu options accordingly */
doc.gameCanvas.addEventListener("contextmenu", function(e) {
    populateRightClick([{
        name: "Create Token (testing)",
        function: function() {
            createPopup(
                "Upload Image", "Upload an image for the token.",
                {type: 2},
                "Cancel", function(e) {return true},
                "Upload", function(e) {
                    const reader = new FileReader();
                    reader.onload = function() {
                        const img = new SavedImage({
                            data: reader.result
                        });
                        savedAssets.push(img);
                        
                        playerStateData.tokens.push(new Token({
                            name: "Random Token",
                            description: "Something cool goes here I think",
                            position: {x: Math.random() * 100 - 50, y: Math.random() * 100 - 50},
                            baseColor: randomColor(),
                            linkedImage: img,
                        }));
                    };
                    reader.readAsDataURL(doc.popupMenuFileDrop.files[0]);
                    return true;
                }
            );
        }
    }]);
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


// an update loop to keep the game running
function update() {
    ctx.clearRect(0, 0, W, H);

    drawGrid({
        shape: "square",
        origin: {x: W/2 - playerStateData.cameraLocation.x, y: H/2 - playerStateData.cameraLocation.y},
        dim: {x: 10, y: 5},
        radius: W/20,
        color: "red",
        lineWidth: R * 0.01,
    });

    // draw every token by their z-index
    playerStateData.tokens = playerStateData.tokens.sort(function(a, b) {
        return a.zIndex - b.zIndex;
    });
    for (let token of playerStateData.tokens) {
        token.render();
    }

    // finally, draw player's mouses over everything
    for (let player of playerStateData.players) {
        player.lerpPosition();
        player.renderMouse();
    }

    requestAnimationFrame(update);
}
requestAnimationFrame(update);
