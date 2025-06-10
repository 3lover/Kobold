const fs = require('fs');
const http = require('http');
const https = require('https');
const privateKey = fs.readFileSync("./security/localhost-key.pem");
const certificate = fs.readFileSync("./security/localhost.pem");
const WebSocket = require("express-ws");
const express = require('express');
const app = express();
const protocol = require("./public/json/protocol.json");
const packet = require("./serverProtocol");
const { disconnect } = require('process');

// the websocket class
const sockets = {
    tally: 1,
    clients: [],
    class: class {
        constructor(socket, request) {
            this.id = sockets.tally++;

            this.socket = socket;
            this.request = request;
            this.socket.binaryType = "arraybuffer";

            socket.onerror = error => this.error(error);
            socket.onclose = reason => this.close(reason);
            socket.onmessage = data => this.message(data);
        }

        message(packet) {
            let reader = new DataView(packet.data);

            switch (reader.getInt8(0)) {
                case protocol.server.checkIfCodeExists: {
                    // checks and informs a client if a lobby code can be attributed to an existing lobby
                    const d = packet.decodePacket(reader, ["int8", "string"]);
                    this.talk(packet.encodePacket([protocol.client.doesCodeExist, Lobby.findCode(d[1]) === null ? 0 : 1], ["int8", "int8"]));
                    break;
                }
                default: {
                    console.log(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                    break;
                }
            }
        }

        close() {
            console.log(`Player ${this.id} has disconnected. Active sockets: ${sockets.clients.length - 1}.`)
            let myIndex = sockets.clients.indexOf(this);
            if (myIndex >= 0) sockets.clients.splice(myIndex, 1);
        }

        talk(data) {
            if (this.socket.readyState === 1) this.socket.send(data, { binary: true });
        }

        error(error) {
            throw error;
        }

        kick(reason) {

        }
    },

    connect(socket, request) {
        // logs the connection attempt, then sends a connection confirmation to a client
        console.log(`Socket ${sockets.tally} has connected. Active sockets: ${sockets.clients.length + 1}`);
        let connectingSocket = new sockets.class(socket, request);
        sockets.clients.push(connectingSocket);
        connectingSocket.talk(packet.encodePacket([protocol.client.connected], ["int8"]));
    }
}

// websocket server stuff, creates a locally hosted server for us
const credentials = { key: privateKey, cert: certificate };

app.use(express.static("public"));
app.get("/", (req, res) => {
    res.sendFile(__dirname + "public/index.html");
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);
WebSocket(app, httpsServer);

app.ws("/wss", sockets.connect);

httpServer.listen(8080);
httpsServer.listen(8443, () => {
    console.log("Server running on port 8443")
});


function update() {
    
}
setInterval(update, 1000/60);