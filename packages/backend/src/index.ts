// src/index.ts
import express from "express";
import * as dotenv from "dotenv";
import questRouter from "./questRoutes";

dotenv.config();

const app = express();
app.use(express.json());

// Mount the quest routes at /claim
app.use("/claim", questRouter);

app.get("/", (req, res) => {
  res.send("Welcome to the Minimiles Daily Quests Backend!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
