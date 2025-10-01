const joi = require("@hapi/joi");


const schema = {
    account_create: joi.object({
        restaurant_name:joi.string().max(50).required(),
        phone_number:joi.number().min(15).required(),
        email:joi.string().email().required(),
        password:joi.string().pattern(new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,30}$")).required(),
         gst_no: joi.string().allow(null, ''),
  pincode: joi.string().allow(null, ''),
  city: joi.string().allow(null, ''),
  district: joi.string().allow(null, ''),
  state: joi.string().allow(null, ''),
  building_no: joi.string().allow(null, ''),
  area_street_name: joi.string().allow(null, ''),
  account_number: joi.string().allow(null, ''),
  account_type: joi.string().allow(null, ''),
  ifsc_code: joi.string().allow(null, '')
    }),
    login: joi.object ({
        phone_number:joi.number().min(10),
        email:joi.string().email(),
        password:joi.string().pattern(new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,30}$")).required()
    }),

}

module.exports = schema ;