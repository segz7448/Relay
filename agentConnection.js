import { API_URL } from "./config";
export const AGENT_HOST = API_URL;
export const MODES = ["Admin", "Builder", "Operator", "Read only"];
export const MODE_HELP = {
  Admin: "Read, configure, send, and delete account resources.",
  Builder: "Read, create, configure, and send without deleting.",
  Operator: "Read and send messages without changing configuration.",
  "Read only": "Monitor resources without changes.",
};
export const agentConfig = (key = "<ACCESS_KEY>") =>
  `RELAY_HOST=${AGENT_HOST}\nRELAY_ACCESS_KEY=${key}\nRELAY_DISCOVERY=${AGENT_HOST}/agent-api`;
