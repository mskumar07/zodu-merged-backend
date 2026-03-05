const repository = require("../repository/branch-repo");

async function getBranches(zodu_id, branch_id) {
  try {
    const branches = await repository.getBranches(zodu_id, branch_id);

    return {
      success: true,
      data: branches
    };
  } catch (error) {
    console.error("Get Branches Error:", error);
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  getBranches
};
