// Généré par supabase/tests/generate-columns.ts : ne pas modifier à la main.
export interface ColumnDefault {
  name: string;
  value: unknown;
  generated?: true;
}

export const TABLE_COLUMNS: Record<string, ColumnDefault[]> = {
  "announcements": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "title",
      "value": null
    },
    {
      "name": "body",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "attendance": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "checked_in_at",
      "value": null
    },
    {
      "name": "checked_out_at",
      "value": null
    },
    {
      "name": "method",
      "value": null
    },
    {
      "name": "status",
      "value": "valid"
    },
    {
      "name": "override_reason",
      "value": null
    },
    {
      "name": "correction_reason",
      "value": null
    },
    {
      "name": "recorded_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "bookings": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "session_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "status",
      "value": "booked"
    },
    {
      "name": "cancelled_at",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "coaches": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "staff_id",
      "value": null
    },
    {
      "name": "full_name",
      "value": null
    },
    {
      "name": "phone",
      "value": null
    },
    {
      "name": "email",
      "value": null
    },
    {
      "name": "specialties",
      "value": []
    },
    {
      "name": "bio",
      "value": null
    },
    {
      "name": "availability",
      "value": []
    },
    {
      "name": "is_active",
      "value": true
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "equipment": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "name",
      "value": null
    },
    {
      "name": "category",
      "value": "Autre"
    },
    {
      "name": "quantity",
      "value": 1
    },
    {
      "name": "purchase_date",
      "value": null
    },
    {
      "name": "purchase_cost",
      "value": null
    },
    {
      "name": "condition",
      "value": "good"
    },
    {
      "name": "location",
      "value": null
    },
    {
      "name": "next_maintenance_on",
      "value": null
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "archived_at",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "equipment_maintenance": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "equipment_id",
      "value": null
    },
    {
      "name": "performed_on",
      "value": null
    },
    {
      "name": "description",
      "value": null
    },
    {
      "name": "cost",
      "value": null
    },
    {
      "name": "performed_by",
      "value": null
    },
    {
      "name": "next_due_on",
      "value": null
    },
    {
      "name": "recorded_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "expenses": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "category",
      "value": null
    },
    {
      "name": "amount",
      "value": null
    },
    {
      "name": "spent_on",
      "value": null
    },
    {
      "name": "description",
      "value": null
    },
    {
      "name": "supplier",
      "value": null
    },
    {
      "name": "payment_method_id",
      "value": null
    },
    {
      "name": "voided_at",
      "value": null
    },
    {
      "name": "void_reason",
      "value": null
    },
    {
      "name": "recorded_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "leads": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "first_name",
      "value": null
    },
    {
      "name": "last_name",
      "value": null
    },
    {
      "name": "phone",
      "value": null
    },
    {
      "name": "email",
      "value": null
    },
    {
      "name": "goal",
      "value": "other"
    },
    {
      "name": "source",
      "value": "walk_in"
    },
    {
      "name": "status",
      "value": "to_contact"
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "trial_at",
      "value": null
    },
    {
      "name": "coach_id",
      "value": null
    },
    {
      "name": "lost_reason",
      "value": null
    },
    {
      "name": "converted_member_id",
      "value": null
    },
    {
      "name": "last_activity_at",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "member_notes": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "body",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "members": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_code",
      "value": null
    },
    {
      "name": "first_name",
      "value": null
    },
    {
      "name": "last_name",
      "value": null
    },
    {
      "name": "photo_path",
      "value": null
    },
    {
      "name": "phone",
      "value": null
    },
    {
      "name": "phone_digits",
      "value": null,
      "generated": true
    },
    {
      "name": "email",
      "value": null
    },
    {
      "name": "birth_date",
      "value": null
    },
    {
      "name": "gender",
      "value": null
    },
    {
      "name": "address",
      "value": null
    },
    {
      "name": "emergency_contact_name",
      "value": null
    },
    {
      "name": "emergency_contact_phone",
      "value": null
    },
    {
      "name": "registered_on",
      "value": null
    },
    {
      "name": "coach_id",
      "value": null
    },
    {
      "name": "archived_at",
      "value": null
    },
    {
      "name": "archive_reason",
      "value": null
    },
    {
      "name": "membership_end_date",
      "value": null
    },
    {
      "name": "membership_suspended",
      "value": false
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    },
    {
      "name": "checkin_pin",
      "value": null
    }
  ],
  "membership_plans": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "name",
      "value": null
    },
    {
      "name": "kind",
      "value": "membership"
    },
    {
      "name": "duration_value",
      "value": null
    },
    {
      "name": "duration_unit",
      "value": null
    },
    {
      "name": "sessions_included",
      "value": null
    },
    {
      "name": "price",
      "value": null
    },
    {
      "name": "description",
      "value": null
    },
    {
      "name": "access_restrictions",
      "value": null
    },
    {
      "name": "is_active",
      "value": true
    },
    {
      "name": "sort_order",
      "value": 0
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "notifications": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "recipient_user_id",
      "value": null
    },
    {
      "name": "type",
      "value": null
    },
    {
      "name": "title",
      "value": null
    },
    {
      "name": "body",
      "value": null
    },
    {
      "name": "link",
      "value": null
    },
    {
      "name": "dedupe_key",
      "value": null
    },
    {
      "name": "read_at",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "organization_settings": [
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "expiry_alert_days",
      "value": 7
    },
    {
      "name": "checkin_debounce_minutes",
      "value": 5
    },
    {
      "name": "receipt_prefix",
      "value": "R"
    },
    {
      "name": "member_code_prefix",
      "value": "M"
    },
    {
      "name": "notify_email",
      "value": false
    },
    {
      "name": "notify_sms",
      "value": false
    },
    {
      "name": "notify_whatsapp",
      "value": false
    },
    {
      "name": "notify_types",
      "value": [
        "membership_expiring",
        "membership_expired",
        "unpaid_balance",
        "upcoming_session",
        "new_member",
        "announcement",
        "equipment_maintenance"
      ]
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "organizations": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "name",
      "value": null
    },
    {
      "name": "slug",
      "value": null
    },
    {
      "name": "legal_name",
      "value": null
    },
    {
      "name": "tax_id",
      "value": null
    },
    {
      "name": "address",
      "value": null
    },
    {
      "name": "phone",
      "value": null
    },
    {
      "name": "email",
      "value": null
    },
    {
      "name": "logo_path",
      "value": null
    },
    {
      "name": "currency",
      "value": "TND"
    },
    {
      "name": "timezone",
      "value": "Africa/Tunis"
    },
    {
      "name": "locale",
      "value": "fr"
    },
    {
      "name": "receipt_footer",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "payment_adjustments": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "payment_id",
      "value": null
    },
    {
      "name": "type",
      "value": null
    },
    {
      "name": "amount",
      "value": null
    },
    {
      "name": "reason",
      "value": null
    },
    {
      "name": "method_id",
      "value": null
    },
    {
      "name": "approved_by",
      "value": null
    },
    {
      "name": "request_id",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    }
  ],
  "payment_methods": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "name",
      "value": null
    },
    {
      "name": "code",
      "value": "other"
    },
    {
      "name": "is_active",
      "value": true
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "payments": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "subscription_id",
      "value": null
    },
    {
      "name": "method_id",
      "value": null
    },
    {
      "name": "amount",
      "value": null
    },
    {
      "name": "refunded_amount",
      "value": 0
    },
    {
      "name": "paid_at",
      "value": null
    },
    {
      "name": "receipt_number",
      "value": null
    },
    {
      "name": "reference",
      "value": null
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "recorded_by",
      "value": null
    },
    {
      "name": "request_id",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    }
  ],
  "progress_entries": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "recorded_on",
      "value": null
    },
    {
      "name": "weight_kg",
      "value": null
    },
    {
      "name": "body_fat_pct",
      "value": null
    },
    {
      "name": "waist_cm",
      "value": null
    },
    {
      "name": "chest_cm",
      "value": null
    },
    {
      "name": "arm_cm",
      "value": null
    },
    {
      "name": "thigh_cm",
      "value": null
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "recorded_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "sessions": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "kind",
      "value": null
    },
    {
      "name": "title",
      "value": null
    },
    {
      "name": "coach_id",
      "value": null
    },
    {
      "name": "room",
      "value": null
    },
    {
      "name": "starts_at",
      "value": null
    },
    {
      "name": "ends_at",
      "value": null
    },
    {
      "name": "capacity",
      "value": null
    },
    {
      "name": "status",
      "value": "scheduled"
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "subscription_events": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "subscription_id",
      "value": null
    },
    {
      "name": "event_type",
      "value": null
    },
    {
      "name": "days",
      "value": null
    },
    {
      "name": "reason",
      "value": null
    },
    {
      "name": "actor_user_id",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    }
  ],
  "subscriptions": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "plan_id",
      "value": null
    },
    {
      "name": "plan_name",
      "value": null
    },
    {
      "name": "kind",
      "value": null
    },
    {
      "name": "start_date",
      "value": null
    },
    {
      "name": "end_date",
      "value": null
    },
    {
      "name": "price",
      "value": null
    },
    {
      "name": "discount",
      "value": 0
    },
    {
      "name": "total_due",
      "value": null,
      "generated": true
    },
    {
      "name": "amount_paid",
      "value": 0
    },
    {
      "name": "sessions_included",
      "value": null
    },
    {
      "name": "sessions_used",
      "value": 0
    },
    {
      "name": "status",
      "value": "active"
    },
    {
      "name": "suspended_on",
      "value": null
    },
    {
      "name": "cancelled_at",
      "value": null
    },
    {
      "name": "cancel_reason",
      "value": null
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "request_id",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "workout_days": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "program_id",
      "value": null
    },
    {
      "name": "day_number",
      "value": null
    },
    {
      "name": "title",
      "value": null
    },
    {
      "name": "muscle_group",
      "value": null
    },
    {
      "name": "position",
      "value": 0
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "workout_exercises": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "day_id",
      "value": null
    },
    {
      "name": "name",
      "value": null
    },
    {
      "name": "sets",
      "value": null
    },
    {
      "name": "reps",
      "value": null
    },
    {
      "name": "rest_seconds",
      "value": null
    },
    {
      "name": "load",
      "value": null
    },
    {
      "name": "instructions",
      "value": null
    },
    {
      "name": "position",
      "value": 0
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "workout_logs": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "program_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "day_id",
      "value": null
    },
    {
      "name": "performed_on",
      "value": null
    },
    {
      "name": "completed",
      "value": true
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "recorded_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ],
  "workout_programs": [
    {
      "name": "id",
      "value": null
    },
    {
      "name": "organization_id",
      "value": null
    },
    {
      "name": "member_id",
      "value": null
    },
    {
      "name": "coach_id",
      "value": null
    },
    {
      "name": "name",
      "value": null
    },
    {
      "name": "goal",
      "value": null
    },
    {
      "name": "start_date",
      "value": null
    },
    {
      "name": "end_date",
      "value": null
    },
    {
      "name": "status",
      "value": "draft"
    },
    {
      "name": "notes",
      "value": null
    },
    {
      "name": "created_by",
      "value": null
    },
    {
      "name": "created_at",
      "value": null
    },
    {
      "name": "updated_at",
      "value": null
    },
    {
      "name": "row_version",
      "value": 1
    }
  ]
};
