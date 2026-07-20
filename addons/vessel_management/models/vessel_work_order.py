from odoo import api, fields, models


class VesselWorkOrder(models.Model):
    _name = "vessel.work.order"
    _description = "Vessel Work Order"
    _inherit = ["mail.thread"]
    _order = "date_open desc"

    name = fields.Char(string="Reference", default="New", copy=False, readonly=True)
    vessel_id = fields.Many2one("vessel.vessel", string="Vessel", required=True, ondelete="cascade")
    company_id = fields.Many2one(
        "res.company", related="vessel_id.company_id", string="Branch/Company", store=True, readonly=True
    )
    equipment_id = fields.Many2one(
        "vessel.equipment", string="Equipment", domain="[('vessel_id', '=', vessel_id)]"
    )
    description = fields.Text(string="Description", required=True)
    technician_id = fields.Many2one("res.users", string="Technician", tracking=True)
    state = fields.Selection(
        [
            ("new", "New"),
            ("in_progress", "In Progress"),
            ("done", "Done"),
            ("cancelled", "Cancelled"),
        ],
        string="Status",
        default="new",
        required=True,
        tracking=True,
    )
    date_open = fields.Datetime(string="Opened On", default=fields.Datetime.now, required=True)
    date_closed = fields.Datetime(string="Closed On")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                vals["name"] = self.env["ir.sequence"].next_by_code("vessel.work.order") or "New"
        return super().create(vals_list)

    def action_start(self):
        self.write({"state": "in_progress"})

    def action_done(self):
        self.write({"state": "done", "date_closed": fields.Datetime.now()})

    def action_cancel(self):
        self.write({"state": "cancelled", "date_closed": fields.Datetime.now()})
