const service = require('./employee.service');

// Joi Wrapper Middleware for cleaner controllers
const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ error: error.details.map(d => d.message) });
    next();
};

class EmployeeController {
    async create(req, res, next) {
        try {
            const result = await service.createEmployee(req.body);
            res.status(201).json(result);
        } catch (err) { next(err); }
    }

    async getAll(req, res, next) {
        try {
            const { page = 1, limit = 10, branch_id } = req.query;
            const offset = (page - 1) * limit;
            const data = await service.getEmployees({ limit, offset, branch_id });
            res.json(data);
        } catch (err) { next(err); }
    }

    async getOne(req, res, next) {
        try {
            const data = await service.getEmployeeById(req.params.id);
            if (!data) return res.status(404).json({ message: "Not Found" });
            res.json(data);
        } catch (err) { next(err); }
    }

    async update(req, res, next) {
        try {
            const data = await service.updateEmployee(req.params.id, req.body);
            res.json({ message: "Updated", data });
        } catch (err) { next(err); }
    }

    async delete(req, res, next) {
        try {
            await service.deleteEmployee(req.params.id);
            res.json({ message: "Deleted" });
        } catch (err) { next(err); }
    }
}

module.exports = { 
    ctrl: new EmployeeController(), 
    validate 
};