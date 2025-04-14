// src/index.ts
import express from "express";
import questRouter from "./questRoutes";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// Use the quest router under /claim
app.use("/claim", questRouter);

// Basic root route
app.get("/", (req, res) => {
  res.send("Welcome to the Quest Backend!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
