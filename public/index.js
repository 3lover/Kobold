import { decodePacket, encodePacket } from "./clientProtocol.js";
import { doc } from "./pageListeners.js";

let socket = null;
let W = window.innerWidth;
let H = window.innerHeight;
let R = W / H;
window.addEventListener("resize", function (e) {
    W = window.innerWidth;
    H = window.innerHeight;
    R = W / H;
});

let protocol = null;
async function fetchProtocol() {
    protocol = await (await fetch("./json/protocol.json")).json();
}
await fetchProtocol();

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