const { 
  FormateData, 
  GeneratePassword, 
  GenerateSalt, 
  GenerateSignature, 
  ValidatePassword 
} = require('../utils');

const repository = require('../repository/auth-repo');
// const { publishAccountCreated } = require('../consumer/consumer');
const axios = require("axios");


// (async () => {
//   try {
//     await connectProducer();  // connect once on startup
//     console.log('Producer ready ✅');
//   } catch (err) {
//     console.error('Failed to connect producer', err);
//   }
// })();

// Account Creation
async function CreateAccount(userInputs) {
  const { restaurant_name, phone_number, email, password } = userInputs;

  // Check if user already exists
  const PhoneNoExist = await repository.findPhnExist({ phone_number });

  if ( PhoneNoExist.rowCount > 1 ) {
    return FormateData({ error: "Phone number Already Exists" });
  }
   const zodu_id = await repository.getNextZoduId();
  // Hash password with salt
  const salt = await GenerateSalt();
  const hashedPassword = await GeneratePassword(password, salt);

  //Create user
  const newUser = await repository.AccountCreationQuery({
   zodu_id, restaurant_name, phone_number, email, password_hash:hashedPassword
  });

  // await publishAccountCreated({ zodu_id, restaurant_name, phone_number, email, });
  try {
    await axios.post("http://restaurant-service:3001/api/createcompany", {
      zodu_id:zodu_id,
      restaurant_name:restaurant_name,
      mobile_no:phone_number,
      mail_id:email,
    });
  } catch (err) {
    console.error("❌ Failed to notify restaurant-service:", err.message);
    // Optional: rollback user creation if restaurant creation fails
  }
  // Step 6: Return response
  return FormateData({ insertData: newUser });
}

// Login
async function AccountLogin(userInputs) {
  const { email, phone_number, password } = userInputs;
  console.log(userInputs);

  if ((!email && !phone_number) || !password) {
    return FormateData({ error: "Email/Phone and Password are required" });
  }

  // Find user by email or phone
  let existingUser;
  if (email) {
    existingUser = await repository.findEmailExist({ email });
  } else {
    existingUser = await repository.findPhnExist({ phone_number });
  }

  if (!existingUser || existingUser.rowCount === 0) {
    return FormateData({ error: "User not found" });
  }

  const user = existingUser.rows[0];

  // Validate password
  const isPasswordValid = await ValidatePassword(password, user.password_hash);
  if (!isPasswordValid) {
    return FormateData({ error: "Invalid credentials" });
  }

  // Generate JWT or session token
  const token = await GenerateSignature({
    id: user.id,
    email: user.email,
    phone_number: user.phone_number
  });

  return FormateData({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      restaurant_name: user.restaruant_name,
      email: user.email,
      phone_number: user.phone_number
    }
  });
}




// Export all functions
module.exports = {
  CreateAccount,
  AccountLogin
};
