import { decodePacket, encodePacket } from "./clientProtocol.js";
import { doc } from "./sheetScripts.js";

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
drawGrid({
    shape: "square",
    origin: {x: W/2, y: H/2},
    dim: {x: 10, y: 5},
    radius: W/20,
    color: "red",
    lineWidth: R * 0.01,
});

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
            case protocol.client.connected: {
                console.log(`Connection confirmed by server on port "${location.host}"`);
                this.connected = true;
                break;
            }
            default: {
                console.log(`An unknown code has been recieved: ${reader.getInt8(0)}`);
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

// an update loop to keep the game running
function update() {
    requestAnimationFrame(update);
}
requestAnimationFrame(update);