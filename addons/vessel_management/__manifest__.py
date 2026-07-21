{
    "name": "Vessel Management",
    "version": "17.0.1.0.0",
    "category": "Industries",
    "summary": "Vessel registry, communication equipment, and maintenance work orders",
    "description": """
Vessel Management
==================
Tracks ships owned/operated by customers (res.partner): identity (IMO,
MMSI, call sign), specifications, ownership, assigned technician, onboard
maritime communication equipment, and the work orders raised to maintain
it.

See docs/VESSEL_MODULE.md in the repository for the full design.
""",
    "author": "Vishipel",
    "license": "LGPL-3",
    "depends": ["base", "mail", "contacts"],
    "data": [
        "security/vessel_security.xml",
        "security/ir.model.access.csv",
        "data/vessel_work_order_sequence.xml",
        "views/vessel_equipment_views.xml",
        "views/vessel_work_order_views.xml",
        "views/vessel_views.xml",
        "views/vessel_menus.xml",
    ],
    "application": True,
    "installable": True,
}
