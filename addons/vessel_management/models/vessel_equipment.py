from odoo import fields, models


class VesselEquipment(models.Model):
    _name = "vessel.equipment"
    _description = "Vessel Communication Equipment"
    _order = "vessel_id, equipment_type"

    vessel_id = fields.Many2one("vessel.vessel", string="Vessel", required=True, ondelete="cascade")
    company_id = fields.Many2one(
        "res.company", related="vessel_id.company_id", string="Branch/Company", store=True, readonly=True
    )
    equipment_type = fields.Selection(
        [
            ("vhf", "VHF"),
            ("mf_hf", "MF/HF"),
            ("inmarsat", "Inmarsat"),
            ("epirb", "EPIRB"),
            ("ais", "AIS"),
            ("sart", "SART"),
            ("navtex", "NAVTEX"),
            ("other", "Other"),
        ],
        string="Equipment Type",
        required=True,
    )
    serial_number = fields.Char(string="Serial Number")
    install_date = fields.Date(string="Install Date")
    last_inspection_date = fields.Date(string="Last Inspection")
    next_inspection_date = fields.Date(string="Next Inspection Due")
    state = fields.Selection(
        [
            ("active", "Active"),
            ("faulty", "Faulty"),
            ("removed", "Removed"),
        ],
        string="Status",
        default="active",
        required=True,
    )
