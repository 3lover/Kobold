import { decodePacket, encodePacket } from "./clientProtocol.js";
import { doc, createPopup, savedAssets, findAsset, Image } from "./sheetScripts.js";

let socket = null;
let W, H, R;
function resize() {
    W = doc.gameCanvas.getBoundingClientRect().width;
    H = doc.gameCanvas.getBoundingClientRect().height;
    doc.gameCanvas.width = W;
    doc.gameCanvas.height = H;
    R = Math.min(W, H);
}
resize();
window.addEventListener("resize", resize);

let ctx = doc.gameCanvas.getContext("2d");
ctx.lineCap = "round";

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

const data = {
    cameraLocation: {x: 0, y: 0}
};


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
    }

    connect() {
        if (this.socket !== null) return;
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
                document.getElementById("simulatorMenu").classList.remove("hidden");
                document.getElementById("frontMenu").classList.add("hidden");
                document.getElementById("loadingScreen").classList.remove("hidden");
                console.log(savedAssets[1]);
                socket.talk(encodePacket(
                    [protocol.server.uploadRequiredAssets, 1, savedAssets[1].id, savedAssets[1].name, savedAssets[1].data, 0],
                    ["int8", "repeat", "int32", "string", "string", "end"]
                ));
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
                    savedAssets.push(new Image({
                        id: d[1][i + 0],
                        name: d[1][i + 1],
                        data: d[1][i + 2],
                    }));
                }
                document.getElementById("loadingScreen").classList.add("hidden");
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
    }
}

socket = new Socket();
socket.connect();
document.getElementById("loadingScreen").classList.add("hidden");

// an update loop to keep the game running
function update() {
    ctx.clearRect(0, 0, W, H);
    
    drawGrid({
        shape: "square",
        origin: {x: W/2 + data.cameraLocation.x, y: H/2 + data.cameraLocation.y},
        dim: {x: 10, y: 5},
        radius: W/20,
        color: "red",
        lineWidth: R * 0.01,
    });

    requestAnimationFrame(update);
}
requestAnimationFrame(update);

// when dragging across the canvas, change the camera position
doc.gameCanvas.addEventListener("mousedown", function(e) {
    data.originalCameraLocation = structuredClone(data.cameraLocation);
    function drag(e2) {
        data.cameraLocation.x = data.originalCameraLocation.x + e2.clientX - e.clientX;
        data.cameraLocation.y = data.originalCameraLocation.y + e2.clientY - e.clientY;
    }
    function release(e2) {
        document.removeEventListener("mousemove", drag);
        document.removeEventListener("mouseup", release);
    }
    
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", release);
})

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