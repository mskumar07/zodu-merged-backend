const service = require('./department.service');

// Simple Joi Wrapper Middleware
const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ error: error.details.map(d => d.message) });
    next();
};

class DepartmentController {
    async create(req, res, next) {
        try {
            const result = await service.createDepartment(req.body);
            res.status(201).json(result);
        } catch (err) { next(err); }
    }

    async getAll(req, res, next) {
        try {
            // Require branch_id to filter departments
            if(!req.query.branch_id) return res.status(400).json({ error: "branch_id query parameter is required" });
            
            const data = await service.getDepartments(req.query);
            res.json(data);
        } catch (err) { next(err); }
    }

    async getOne(req, res, next) {
        try {
            const data = await service.getDepartmentById(req.params.id);
            if (!data) return res.status(404).json({ message: "Department Not Found" });
            res.json(data);
        } catch (err) { next(err); }
    }

    async update(req, res, next) {
        try {
            const data = await service.updateDepartment(req.params.id, req.body);
            if (!data) return res.status(404).json({ message: "Department Not Found" });
            res.json({ message: "Updated Successfully", data });
        } catch (err) { next(err); }
    }

    async delete(req, res, next) {
        try {
            const success = await service.deleteDepartment(req.params.id);
            if (!success) return res.status(404).json({ message: "Department Not Found" });
            res.json({ message: "Department Deleted (Soft)" });
        } catch (err) { next(err); }
    }
}

module.exports = { 
    ctrl: new DepartmentController(), 
    validate 
};