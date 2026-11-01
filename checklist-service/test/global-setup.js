// A stand-in auth-service (keys + branch-access check) for the whole run.
module.exports = () => require('@zodu/security/testing').startFakeAuth();
