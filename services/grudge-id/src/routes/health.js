"use strict";

const { Router } = require("express");
const { ping } = require("../db");

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    await ping();
    res.json({ status: "ok", service: "grudge-id", ts: Date.now() });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

module.exports = router;
