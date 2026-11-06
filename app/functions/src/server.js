import { app } from "./index.js";

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`QDoc backend listening on ${port}`);
});
