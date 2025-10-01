const express = require("express");
const authService = require("../services/auth-service");
const RequestValidator = require("../utils/requestValidator")
const schema = require("../schema/auth-schema");
const STATUS_CODES = require("../utils/error/status-codes");
const { logger } = require("../utils");
const functions = require("../utils");



const router = express.Router();


// endpoints
router.post("/api/create-account", async (req, res) => {
  try {
    console.log("Request body:", req.body);
    const { errors, input } = await RequestValidator(
      schema.account_create,
      req.body
    );
    if (errors){
      logger.error("Validation errors:", errors);
      return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });
    }
    const data = await authService.CreateAccount(input);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    console.log(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});


router.post("/api/login", async (req, res) => {
  try {
    console.log("Request body:", req.body);
    const { errors, input } = await RequestValidator(
      schema.login,
      req.body
    );
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json(errors);
    const data = await authService.AccountLogin(input);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    console.log(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

router.get("/api/auth-check",functions.ValidateSignature, async (req, res) => {
  try {
    logger.info("Auth check endpoint hit");
    return res.status(STATUS_CODES.OK).json({ message: "You are authorized" });
  } catch (error) {
    console.log(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});



module.exports = router;
