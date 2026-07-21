import re

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError

_IMO_RE = re.compile(r"^\d{7}$")
_MMSI_RE = re.compile(r"^\d{9}$")

# Allowed forward transitions. Decommissioned is terminal.
_STATE_TRANSITIONS = {
    "draft": {"registered"},
    "registered": {"active"},
    "active": {"out_of_service", "decommissioned"},
    "out_of_service": {"active", "decommissioned"},
    "decommissioned": set(),
}


class Vessel(models.Model):
    _name = "vessel.vessel"
    _description = "Vessel"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "name"

    name = fields.Char(string="Vessel Name", required=True, tracking=True)
    imo_number = fields.Char(string="IMO Number", required=True, tracking=True)
    mmsi = fields.Char(string="MMSI")
    call_sign = fields.Char(string="Call Sign")
    vessel_type = fields.Selection(
        [
            ("cargo", "Cargo"),
            ("tanker", "Tanker"),
            ("fishing", "Fishing"),
            ("passenger", "Passenger"),
            ("tug", "Tug"),
            ("other", "Other"),
        ],
        string="Vessel Type",
        required=True,
        default="cargo",
        tracking=True,
    )
    flag_state = fields.Char(string="Flag State")
    home_port = fields.Char(string="Home Port")
    gross_tonnage = fields.Float(string="Gross Tonnage (GT)")
    length_overall = fields.Float(string="Length Overall (m)")

    owner_id = fields.Many2one("res.partner", string="Owner", required=True, tracking=True)
    operator_id = fields.Many2one("res.partner", string="Operator")
    company_id = fields.Many2one(
        "res.company", string="Branch/Company", required=True, default=lambda self: self.env.company
    )
    technician_id = fields.Many2one("res.users", string="Assigned Technician", tracking=True)

    state = fields.Selection(
        [
            ("draft", "Draft"),
            ("registered", "Registered"),
            ("active", "Active"),
            ("out_of_service", "Out of Service"),
            ("decommissioned", "Decommissioned"),
        ],
        string="Status",
        default="draft",
        required=True,
        tracking=True,
    )

    equipment_ids = fields.One2many("vessel.equipment", "vessel_id", string="Equipment")
    work_order_ids = fields.One2many("vessel.work.order", "vessel_id", string="Work Orders")
    equipment_count = fields.Integer(compute="_compute_equipment_count")
    open_work_order_count = fields.Integer(compute="_compute_open_work_order_count")

    note = fields.Text(string="Notes")
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ("imo_number_unique", "unique(imo_number)", "IMO number must be unique."),
    ]

    @api.depends("equipment_ids")
    def _compute_equipment_count(self):
        for vessel in self:
            vessel.equipment_count = len(vessel.equipment_ids)

    @api.depends("work_order_ids.state")
    def _compute_open_work_order_count(self):
        for vessel in self:
            vessel.open_work_order_count = len(
                vessel.work_order_ids.filtered(lambda wo: wo.state in ("new", "in_progress"))
            )

    @api.constrains("imo_number")
    def _check_imo_number(self):
        for vessel in self:
            if not _IMO_RE.match(vessel.imo_number or ""):
                raise ValidationError(_("IMO number must be exactly 7 digits."))

    @api.constrains("mmsi")
    def _check_mmsi(self):
        for vessel in self:
            if vessel.mmsi:
                if not _MMSI_RE.match(vessel.mmsi):
                    raise ValidationError(_("MMSI must be exactly 9 digits."))
                duplicate = self.search_count([("mmsi", "=", vessel.mmsi), ("id", "!=", vessel.id)])
                if duplicate:
                    raise ValidationError(_("MMSI %s is already assigned to another vessel.") % vessel.mmsi)

    @api.constrains("call_sign")
    def _check_call_sign(self):
        for vessel in self:
            if vessel.call_sign:
                duplicate = self.search_count(
                    [("call_sign", "=", vessel.call_sign), ("id", "!=", vessel.id)]
                )
                if duplicate:
                    raise ValidationError(
                        _("Call sign %s is already assigned to another vessel.") % vessel.call_sign
                    )

    def _apply_transition(self, target_state):
        for vessel in self:
            allowed = _STATE_TRANSITIONS.get(vessel.state, set())
            if target_state not in allowed:
                raise UserError(
                    _("Cannot move vessel '%s' from '%s' to '%s'.") % (vessel.name, vessel.state, target_state)
                )
        self.write({"state": target_state})

    def action_register(self):
        self._apply_transition("registered")

    def action_activate(self):
        self._apply_transition("active")

    def action_set_out_of_service(self):
        self._apply_transition("out_of_service")

    def action_decommission(self):
        for vessel in self:
            if vessel.open_work_order_count:
                raise UserError(
                    _("Cannot decommission '%s' while it has open work orders.") % vessel.name
                )
        self._apply_transition("decommissioned")
