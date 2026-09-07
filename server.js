const http = require("http");
const app = require("./src/app");
const { initSocket } = require("./src/socket/index");

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});