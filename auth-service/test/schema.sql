-- Schema of the auth-service database (pg_dump --schema-only, no data), used to
-- build a throwaway database for the tests. Refresh it after adding a migration:
--   pg_dump --schema-only --no-owner --no-privileges --no-comments retail_auth_service
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: fn_default_invoice_settings_printer_inch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_default_invoice_settings_printer_inch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    company_type VARCHAR(50);
BEGIN
    IF EXISTS (
        SELECT 1 FROM tbl_invoice_settings
        WHERE zodu_id = NEW.zodu_id
          AND branch_id = NEW.branch_id
          AND document_type = NEW.document_type
    ) THEN
        RETURN NEW;
    END IF;

    IF NEW.printer_inch IS NULL OR NEW.printer_inch = '3 Inch' THEN
        SELECT type INTO company_type FROM tbl_business WHERE zodu_id = NEW.zodu_id;

        IF lower(company_type) = 'retail' THEN
            NEW.printer_inch := 'A4';
        ELSE
            NEW.printer_inch := '3 Inch';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_purge_branch(character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_purge_branch(p_zodu_id character varying, p_branch_id character varying) RETURNS TABLE(table_name text, rows_deleted bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_pos_settings WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_pos_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_invoice_settings WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_invoice_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_roles WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_user_roles WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_user_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_subscription WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_subscription'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_branch WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_branch'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$;


--
-- Name: fn_purge_company(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_purge_company(p_zodu_id character varying) RETURNS TABLE(table_name text, rows_deleted bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
    n BIGINT;
    v_affected_users UUID[];
BEGIN
    -- Users who have access to this company, captured before their
    -- tbl_user_companies mapping row is removed below.
    SELECT ARRAY_AGG(DISTINCT user_id) INTO v_affected_users
    FROM tbl_user_companies
    WHERE zodu_id = p_zodu_id;

    DELETE FROM tbl_access_control WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_access_control'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_user_roles WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_user_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_roles WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_pos_settings WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_pos_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_invoice_settings WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_invoice_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_branch WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_branch'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_user_companies WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_user_companies'; rows_deleted := n; RETURN NEXT;

    -- Of the users who had access to this company, fully delete any that
    -- now have zero remaining companies (tbl_user_sessions cascades).
    IF v_affected_users IS NOT NULL THEN
        DELETE FROM tbl_users u
        WHERE u.user_id = ANY(v_affected_users)
          AND NOT EXISTS (
            SELECT 1 FROM tbl_user_companies uc WHERE uc.user_id = u.user_id
          );
        GET DIAGNOSTICS n = ROW_COUNT;
    ELSE
        n := 0;
    END IF;
    table_name := 'tbl_users'; rows_deleted := n; RETURN NEXT;

    -- Root company record first — tbl_business.address_id/bank_details_id
    -- are forward FKs to tbl_address/tbl_bank_details (no ON DELETE CASCADE),
    -- so tbl_business must be gone before those two are deleted below, or
    -- Postgres blocks it with fk_company_bank / fk_company_address.
    -- tbl_branch (deleted above) carries the same two FKs and is already
    -- gone by this point.
    DELETE FROM tbl_business WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_business'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_bank_details WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_bank_details'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_address WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_address'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$;


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: fn_touch_invoice_settings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_touch_invoice_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: fn_touch_pos_settings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_touch_pos_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: tbl_access_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_access_control (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    zodu_id character varying(50) NOT NULL,
    module_id uuid NOT NULL,
    can_read boolean DEFAULT false,
    can_create boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_delete boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    branch_id character varying(50)
);


--
-- Name: tbl_address; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_address (
    id integer NOT NULL,
    zodu_id character varying(50) NOT NULL,
    address_line_1 character varying(100),
    address_line_2 character varying(100),
    city character varying(50),
    district character varying(50),
    state character varying(50),
    pincode character varying(10),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_address_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_address_id_seq OWNED BY public.tbl_address.id;


--
-- Name: tbl_bank_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_bank_details (
    id integer NOT NULL,
    zodu_id character varying(50) NOT NULL,
    account_number character varying(30),
    account_type character varying(20),
    ifsc_code character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    bank_name character varying(255),
    bank_branch character varying(255),
    holder_name character varying(255)
);


--
-- Name: tbl_bank_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_bank_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_bank_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_bank_details_id_seq OWNED BY public.tbl_bank_details.id;


--
-- Name: tbl_branch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_branch (
    id integer NOT NULL,
    branch_id character varying(50) NOT NULL,
    zodu_id character varying(50) NOT NULL,
    branch_name character varying(100) NOT NULL,
    branch_manager character varying(100),
    branch_mobile_no character varying(15),
    branch_mail_id character varying(100),
    branch_image text,
    address_id integer,
    bank_details_id integer,
    active boolean DEFAULT true,
    qr_code_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    same_as_address boolean DEFAULT false,
    same_as_bank_details boolean DEFAULT false
);


--
-- Name: tbl_branch_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_branch_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_branch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_branch_id_seq OWNED BY public.tbl_branch.id;


--
-- Name: tbl_business; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_business (
    id integer NOT NULL,
    zodu_id character varying(50) NOT NULL,
    owner_admin_name character varying(100),
    business_name character varying(100) NOT NULL,
    mobile_no character varying(15),
    mail_id character varying(100),
    gst_no character varying(50),
    address_id integer,
    bank_details_id integer,
    status boolean,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    type character varying(50),
    company_logo_url text,
    company_logo_file_id uuid
);


--
-- Name: tbl_business_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_business_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_business_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_business_id_seq OWNED BY public.tbl_business.id;


--
-- Name: tbl_invoice_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_invoice_settings (
    id integer NOT NULL,
    zodu_id character varying(50) NOT NULL,
    branch_id character varying(50) NOT NULL,
    invoice_prefix character varying(20) DEFAULT 'INV'::character varying NOT NULL,
    default_tax_label character varying(50) DEFAULT 'GST 18%'::character varying NOT NULL,
    invoice_due_days smallint DEFAULT 15 NOT NULL,
    default_payment_method character varying(30) DEFAULT 'Cash'::character varying NOT NULL,
    printer_inch character varying(10) DEFAULT '3 Inch'::character varying NOT NULL,
    show_company_logo boolean DEFAULT true NOT NULL,
    print_thank_you_message boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    show_item_id boolean DEFAULT true NOT NULL,
    show_description boolean DEFAULT true NOT NULL,
    invoice_start_number integer DEFAULT 1 NOT NULL,
    show_customer_details boolean DEFAULT true NOT NULL,
    show_tax_details boolean DEFAULT true NOT NULL,
    show_payment_details boolean DEFAULT true NOT NULL,
    show_bank_details boolean DEFAULT false NOT NULL,
    show_signature boolean DEFAULT false NOT NULL,
    show_terms_conditions boolean DEFAULT false NOT NULL,
    terms_conditions text,
    show_notes boolean DEFAULT false NOT NULL,
    notes text,
    invoice_theme_color character varying(225) DEFAULT '#C62828'::character varying NOT NULL,
    signature_url text,
    payment_types text[] DEFAULT ARRAY['Cash'::text, 'UPI'::text, 'Cheque'::text, 'Bank Transfer'::text, 'Others'::text] NOT NULL,
    invoice_template text,
    stock_check_enabled boolean DEFAULT false NOT NULL,
    customer_mandatory boolean DEFAULT false NOT NULL,
    invoice_copy_types text[] DEFAULT ARRAY['Original'::text] NOT NULL,
    show_shipping_address boolean DEFAULT false NOT NULL,
    show_serial_no boolean DEFAULT true NOT NULL,
    invoice_prefix_enabled boolean DEFAULT true NOT NULL,
    show_watermark boolean DEFAULT false NOT NULL,
    watermark_url text,
    show_receiver_signature boolean DEFAULT false NOT NULL,
    receiver_signature_url text,
    show_quotation_terms boolean DEFAULT false NOT NULL,
    quotation_terms text,
    show_proforma_terms boolean DEFAULT false NOT NULL,
    proforma_terms text,
    document_type character varying(10) DEFAULT 'invoice'::character varying NOT NULL,
    signature_file_id uuid,
    watermark_file_id uuid,
    receiver_signature_file_id uuid,
    CONSTRAINT chk_invoice_settings_copy_types CHECK (((COALESCE(array_length(invoice_copy_types, 1), 0) >= 1) AND (invoice_copy_types <@ ARRAY['Original'::text, 'Duplicate'::text, 'Transport'::text]))),
    CONSTRAINT chk_invoice_settings_document_type CHECK (((document_type)::text = ANY ((ARRAY['invoice'::character varying, 'quotation'::character varying, 'proforma'::character varying])::text[]))),
    CONSTRAINT chk_invoice_settings_payment_types CHECK (((COALESCE(array_length(payment_types, 1), 0) >= 1) AND (payment_types <@ ARRAY['Cash'::text, 'UPI'::text, 'Cheque'::text, 'Bank Transfer'::text, 'Others'::text]))),
    CONSTRAINT chk_invoice_settings_theme_color CHECK (((invoice_theme_color)::text ~ '^#[0-9A-Fa-f]{6}$'::text))
);


--
-- Name: tbl_invoice_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_invoice_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_invoice_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_invoice_settings_id_seq OWNED BY public.tbl_invoice_settings.id;


--
-- Name: tbl_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_modules (
    module_id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_name character varying(100) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    parent_module_id uuid,
    sort_order integer DEFAULT 0
);


--
-- Name: tbl_pos_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_pos_settings (
    id integer NOT NULL,
    zodu_id character varying(50) NOT NULL,
    branch_id character varying(50) NOT NULL,
    pos_types text[] DEFAULT ARRAY['Invoice'::text, 'Quotation'::text, 'Proforma'::text] NOT NULL,
    default_pos_type character varying(20) DEFAULT 'Invoice'::character varying NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    invoice_suffix character varying(20),
    invoice_suffix_enabled boolean DEFAULT false NOT NULL,
    quotation_prefix character varying(20) DEFAULT 'QUO'::character varying NOT NULL,
    proforma_prefix character varying(20) DEFAULT 'PRO'::character varying NOT NULL,
    quotation_prefix_enabled boolean DEFAULT true NOT NULL,
    proforma_prefix_enabled boolean DEFAULT true NOT NULL,
    quotation_suffix character varying(20),
    quotation_suffix_enabled boolean DEFAULT false NOT NULL,
    proforma_suffix character varying(20),
    proforma_suffix_enabled boolean DEFAULT false NOT NULL,
    purchase_order_enabled boolean DEFAULT true NOT NULL,
    hold_enabled boolean DEFAULT true NOT NULL,
    pos_screen_type character varying(20) DEFAULT 'Touch'::character varying NOT NULL,
    kot_print_enabled boolean DEFAULT false NOT NULL,
    show_item_image boolean DEFAULT true NOT NULL,
    item_description_enabled boolean DEFAULT true NOT NULL,
    vehicle_no_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_pos_settings_default_in_types CHECK (((default_pos_type)::text = ANY (pos_types))),
    CONSTRAINT chk_pos_settings_default_pos_type CHECK (((default_pos_type)::text = ANY (ARRAY['Invoice'::text, 'Quotation'::text, 'Proforma'::text]))),
    CONSTRAINT chk_pos_settings_pos_types CHECK (((COALESCE(array_length(pos_types, 1), 0) >= 1) AND (pos_types <@ ARRAY['Invoice'::text, 'Quotation'::text, 'Proforma'::text])))
);


--
-- Name: tbl_pos_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_pos_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_pos_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_pos_settings_id_seq OWNED BY public.tbl_pos_settings.id;


--
-- Name: tbl_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_roles (
    role_id uuid DEFAULT gen_random_uuid() NOT NULL,
    zodu_id character varying(50) NOT NULL,
    role_name character varying(100) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    branch_id character varying(50)
);


--
-- Name: tbl_schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_schema_migrations (
    migration_file character varying(255) NOT NULL,
    applied_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tbl_subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_subscription (
    id integer NOT NULL,
    zodu_id character varying(50) NOT NULL,
    branch_id character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'trial'::character varying NOT NULL,
    plan_code character varying(50),
    trial_start_date timestamp without time zone,
    trial_end_date timestamp without time zone,
    subscription_start_date timestamp without time zone,
    subscription_end_date timestamp without time zone,
    cancelled_at timestamp without time zone,
    payment_provider character varying(30),
    payment_ref_id character varying(100),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tbl_subscription_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_subscription_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_subscription_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_subscription_id_seq OWNED BY public.tbl_subscription.id;


--
-- Name: tbl_user_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_user_companies (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    zodu_id character varying(50) NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    branch_ids jsonb,
    access_level character varying DEFAULT 'super_admin'::character varying,
    type character varying(50)
);


--
-- Name: tbl_user_companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_user_companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_user_companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_user_companies_id_seq OWNED BY public.tbl_user_companies.id;


--
-- Name: tbl_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    zodu_id character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    branch_id character varying(50),
    reporting_manager_id uuid,
    access_level character varying(30) DEFAULT 'Full Access'::character varying,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_user_sessions (
    session_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    refresh_token text NOT NULL,
    ip_address character varying(100),
    user_agent text,
    expires_at timestamp without time zone NOT NULL,
    is_revoked boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_users (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255),
    phone character varying(20),
    password_hash text NOT NULL,
    user_type character varying(20) NOT NULL,
    is_active boolean DEFAULT true,
    is_deleted boolean DEFAULT false,
    last_login_at timestamp with time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    login_user boolean DEFAULT true NOT NULL,
    CONSTRAINT tbl_users_user_type_check CHECK (((user_type)::text = ANY (ARRAY[('super_admin'::character varying)::text, ('employee'::character varying)::text])))
);


--
-- Name: zodu_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zodu_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_address id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_address ALTER COLUMN id SET DEFAULT nextval('public.tbl_address_id_seq'::regclass);


--
-- Name: tbl_bank_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_bank_details ALTER COLUMN id SET DEFAULT nextval('public.tbl_bank_details_id_seq'::regclass);


--
-- Name: tbl_branch id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_branch ALTER COLUMN id SET DEFAULT nextval('public.tbl_branch_id_seq'::regclass);


--
-- Name: tbl_business id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_business ALTER COLUMN id SET DEFAULT nextval('public.tbl_business_id_seq'::regclass);


--
-- Name: tbl_invoice_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_invoice_settings ALTER COLUMN id SET DEFAULT nextval('public.tbl_invoice_settings_id_seq'::regclass);


--
-- Name: tbl_pos_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_pos_settings ALTER COLUMN id SET DEFAULT nextval('public.tbl_pos_settings_id_seq'::regclass);


--
-- Name: tbl_subscription id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_subscription ALTER COLUMN id SET DEFAULT nextval('public.tbl_subscription_id_seq'::regclass);


--
-- Name: tbl_user_companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_companies ALTER COLUMN id SET DEFAULT nextval('public.tbl_user_companies_id_seq'::regclass);


--
-- Name: tbl_access_control tbl_access_control_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_access_control
    ADD CONSTRAINT tbl_access_control_id_key UNIQUE (id);


--
-- Name: tbl_access_control tbl_access_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_access_control
    ADD CONSTRAINT tbl_access_control_pkey PRIMARY KEY (id);


--
-- Name: tbl_access_control tbl_access_control_role_id_module_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_access_control
    ADD CONSTRAINT tbl_access_control_role_id_module_id_key UNIQUE (role_id, module_id);


--
-- Name: tbl_access_control tbl_access_control_role_module_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_access_control
    ADD CONSTRAINT tbl_access_control_role_module_key UNIQUE (role_id, module_id);


--
-- Name: tbl_address tbl_address_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_address
    ADD CONSTRAINT tbl_address_pkey PRIMARY KEY (id);


--
-- Name: tbl_bank_details tbl_bank_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_bank_details
    ADD CONSTRAINT tbl_bank_details_pkey PRIMARY KEY (id);


--
-- Name: tbl_branch tbl_branch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_branch
    ADD CONSTRAINT tbl_branch_pkey PRIMARY KEY (id);


--
-- Name: tbl_business tbl_business_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_business
    ADD CONSTRAINT tbl_business_pkey PRIMARY KEY (id);


--
-- Name: tbl_modules tbl_modules_name_parent_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_modules
    ADD CONSTRAINT tbl_modules_name_parent_unique UNIQUE (module_name, parent_module_id);


--
-- Name: tbl_modules tbl_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_modules
    ADD CONSTRAINT tbl_modules_pkey PRIMARY KEY (module_id);


--
-- Name: tbl_pos_settings tbl_pos_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_pos_settings
    ADD CONSTRAINT tbl_pos_settings_pkey PRIMARY KEY (id);


--
-- Name: tbl_roles tbl_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_roles
    ADD CONSTRAINT tbl_roles_pkey PRIMARY KEY (role_id);


--
-- Name: tbl_roles tbl_roles_zodu_id_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_roles
    ADD CONSTRAINT tbl_roles_zodu_id_role_name_key UNIQUE (zodu_id, role_name);


--
-- Name: tbl_schema_migrations tbl_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_schema_migrations
    ADD CONSTRAINT tbl_schema_migrations_pkey PRIMARY KEY (migration_file);


--
-- Name: tbl_subscription tbl_subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_subscription
    ADD CONSTRAINT tbl_subscription_pkey PRIMARY KEY (id);


--
-- Name: tbl_subscription tbl_subscription_zodu_id_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_subscription
    ADD CONSTRAINT tbl_subscription_zodu_id_branch_id_key UNIQUE (zodu_id, branch_id);


--
-- Name: tbl_user_companies tbl_user_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_companies
    ADD CONSTRAINT tbl_user_companies_pkey PRIMARY KEY (id);


--
-- Name: tbl_user_companies tbl_user_companies_user_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_companies
    ADD CONSTRAINT tbl_user_companies_user_id UNIQUE (id);


--
-- Name: tbl_user_companies tbl_user_companies_user_zodu_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_companies
    ADD CONSTRAINT tbl_user_companies_user_zodu_key UNIQUE (user_id, zodu_id);


--
-- Name: tbl_user_roles tbl_user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_roles
    ADD CONSTRAINT tbl_user_roles_pkey PRIMARY KEY (id);


--
-- Name: tbl_user_roles tbl_user_roles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_roles
    ADD CONSTRAINT tbl_user_roles_user_id_key UNIQUE (id);


--
-- Name: tbl_user_roles tbl_user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_roles
    ADD CONSTRAINT tbl_user_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- Name: tbl_user_roles tbl_user_roles_user_zodu_branch_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_roles
    ADD CONSTRAINT tbl_user_roles_user_zodu_branch_key UNIQUE (user_id, zodu_id, branch_id);


--
-- Name: tbl_user_sessions tbl_user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_sessions
    ADD CONSTRAINT tbl_user_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: tbl_users tbl_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_users
    ADD CONSTRAINT tbl_users_email_key UNIQUE (email);


--
-- Name: tbl_users tbl_users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_users
    ADD CONSTRAINT tbl_users_phone_key UNIQUE (phone);


--
-- Name: tbl_users tbl_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_users
    ADD CONSTRAINT tbl_users_pkey PRIMARY KEY (user_id);


--
-- Name: tbl_invoice_settings uq_invoice_settings_zodu_branch_doc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_invoice_settings
    ADD CONSTRAINT uq_invoice_settings_zodu_branch_doc UNIQUE (zodu_id, branch_id, document_type);


--
-- Name: tbl_pos_settings uq_pos_settings_zodu_branch; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_pos_settings
    ADD CONSTRAINT uq_pos_settings_zodu_branch UNIQUE (zodu_id, branch_id);


--
-- Name: idx_access_control_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_control_role ON public.tbl_access_control USING btree (role_id);


--
-- Name: idx_access_control_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_control_zodu ON public.tbl_access_control USING btree (zodu_id, role_id);


--
-- Name: idx_active_sessions_only; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_sessions_only ON public.tbl_user_sessions USING btree (user_id) WHERE (is_revoked = false);


--
-- Name: idx_address_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_address_city ON public.tbl_address USING btree (city);


--
-- Name: idx_address_pincode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_address_pincode ON public.tbl_address USING btree (pincode);


--
-- Name: idx_address_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_address_state ON public.tbl_address USING btree (state);


--
-- Name: idx_address_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_address_zodu ON public.tbl_address USING btree (zodu_id);


--
-- Name: idx_bank_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_account ON public.tbl_bank_details USING btree (account_number);


--
-- Name: idx_bank_ifsc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_ifsc ON public.tbl_bank_details USING btree (ifsc_code);


--
-- Name: idx_bank_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_zodu ON public.tbl_bank_details USING btree (zodu_id);


--
-- Name: idx_company_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_address ON public.tbl_business USING btree (address_id);


--
-- Name: idx_company_mail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_mail ON public.tbl_business USING btree (mail_id);


--
-- Name: idx_company_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_mobile ON public.tbl_business USING btree (mobile_no);


--
-- Name: idx_modules_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_modules_id ON public.tbl_modules USING btree (module_id);


--
-- Name: idx_modules_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_modules_name ON public.tbl_modules USING btree (module_name);


--
-- Name: idx_roles_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_role_id ON public.tbl_roles USING btree (role_id);


--
-- Name: idx_roles_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_zodu ON public.tbl_roles USING btree (zodu_id);


--
-- Name: idx_sb_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sb_active ON public.tbl_branch USING btree (active);


--
-- Name: idx_sb_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sb_address ON public.tbl_branch USING btree (address_id);


--
-- Name: idx_sb_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sb_zodu ON public.tbl_branch USING btree (zodu_id);


--
-- Name: idx_sessions_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expiry ON public.tbl_user_sessions USING btree (expires_at);


--
-- Name: idx_sessions_expiry_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expiry_active ON public.tbl_user_sessions USING btree (expires_at, is_revoked);


--
-- Name: idx_sessions_refresh_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sessions_refresh_token ON public.tbl_user_sessions USING btree (refresh_token);


--
-- Name: idx_sessions_revoked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_revoked ON public.tbl_user_sessions USING btree (is_revoked);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user ON public.tbl_user_sessions USING btree (user_id);


--
-- Name: idx_sessions_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_active ON public.tbl_user_sessions USING btree (user_id, is_revoked);


--
-- Name: idx_uc_branch_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uc_branch_ids ON public.tbl_user_companies USING gin (branch_ids);


--
-- Name: idx_uc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uc_user ON public.tbl_user_companies USING btree (user_id);


--
-- Name: idx_uc_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uc_zodu ON public.tbl_user_companies USING btree (zodu_id);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role ON public.tbl_user_roles USING btree (role_id);


--
-- Name: idx_user_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user ON public.tbl_user_roles USING btree (user_id);


--
-- Name: idx_user_roles_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_zodu ON public.tbl_user_roles USING btree (zodu_id);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.tbl_users USING btree (is_active);


--
-- Name: idx_users_active_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active_not_deleted ON public.tbl_users USING btree (is_active, is_deleted);


--
-- Name: uq_branch_per_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_branch_per_zodu ON public.tbl_branch USING btree (zodu_id, branch_id);


--
-- Name: uq_company_zodu; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_company_zodu ON public.tbl_business USING btree (zodu_id);


--
-- Name: uq_user_company; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_company ON public.tbl_user_companies USING btree (user_id, zodu_id);


--
-- Name: uq_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_role ON public.tbl_user_roles USING btree (user_id, role_id);


--
-- Name: tbl_invoice_settings trg_default_invoice_settings_printer_inch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_default_invoice_settings_printer_inch BEFORE INSERT ON public.tbl_invoice_settings FOR EACH ROW EXECUTE FUNCTION public.fn_default_invoice_settings_printer_inch();


--
-- Name: tbl_invoice_settings trg_touch_invoice_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_invoice_settings_updated_at BEFORE UPDATE ON public.tbl_invoice_settings FOR EACH ROW EXECUTE FUNCTION public.fn_touch_invoice_settings_updated_at();


--
-- Name: tbl_pos_settings trg_touch_pos_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_pos_settings_updated_at BEFORE UPDATE ON public.tbl_pos_settings FOR EACH ROW EXECUTE FUNCTION public.fn_touch_pos_settings_updated_at();


--
-- Name: tbl_users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.tbl_users FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tbl_branch fk_branch_address; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_branch
    ADD CONSTRAINT fk_branch_address FOREIGN KEY (address_id) REFERENCES public.tbl_address(id);


--
-- Name: tbl_branch fk_branch_bank; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_branch
    ADD CONSTRAINT fk_branch_bank FOREIGN KEY (bank_details_id) REFERENCES public.tbl_bank_details(id);


--
-- Name: tbl_business fk_company_address; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_business
    ADD CONSTRAINT fk_company_address FOREIGN KEY (address_id) REFERENCES public.tbl_address(id);


--
-- Name: tbl_business fk_company_bank; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_business
    ADD CONSTRAINT fk_company_bank FOREIGN KEY (bank_details_id) REFERENCES public.tbl_bank_details(id);


--
-- Name: tbl_pos_settings fk_pos_settings_zodu_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_pos_settings
    ADD CONSTRAINT fk_pos_settings_zodu_id FOREIGN KEY (zodu_id) REFERENCES public.tbl_business(zodu_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tbl_access_control tbl_access_control_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_access_control
    ADD CONSTRAINT tbl_access_control_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.tbl_modules(module_id) ON DELETE CASCADE;


--
-- Name: tbl_access_control tbl_access_control_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_access_control
    ADD CONSTRAINT tbl_access_control_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.tbl_roles(role_id) ON DELETE CASCADE;


--
-- Name: tbl_modules tbl_modules_parent_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_modules
    ADD CONSTRAINT tbl_modules_parent_module_id_fkey FOREIGN KEY (parent_module_id) REFERENCES public.tbl_modules(module_id);


--
-- Name: tbl_subscription tbl_subscription_zodu_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_subscription
    ADD CONSTRAINT tbl_subscription_zodu_id_branch_id_fkey FOREIGN KEY (zodu_id, branch_id) REFERENCES public.tbl_branch(zodu_id, branch_id) ON DELETE CASCADE;


--
-- Name: tbl_user_companies tbl_user_companies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_companies
    ADD CONSTRAINT tbl_user_companies_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tbl_users(user_id);


--
-- Name: tbl_user_sessions tbl_user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_user_sessions
    ADD CONSTRAINT tbl_user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tbl_users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


