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

async function updateBranch(zodu_id, branch_id, updateData) {
  try {
    console.log("repo",updateData)
    const existing = await repository.getBranchByIds(zodu_id, branch_id);
    if (!existing) {
      return {
        success: false,
        message: "Branch not found"
      };
    }

    const updated = await repository.updateBranch(zodu_id, branch_id, updateData);
    console.log(updated)
    return {
      success: true,
      data: updated
    };
  } catch (error) {
    console.error("Update Branch Error:", error);
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  getBranches,
  updateBranch
};
