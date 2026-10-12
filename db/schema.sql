--
-- PostgreSQL database dump
--

\restrict le0ugOQcP7HhZj3LePoxvWvN0sjfbOxK4UbcpVLGeC7eA61bN9UEUBa85z2lttF

-- Dumped from database version 16.10 (Debian 16.10-1.pgdg12+1)
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: api; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA api;


--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: app_role; Type: TYPE; Schema: api; Owner: -
--

CREATE TYPE api.app_role AS ENUM (
    'student',
    'instructor',
    'admin'
);


--
-- Name: attempt_outcome; Type: TYPE; Schema: api; Owner: -
--

CREATE TYPE api.attempt_outcome AS ENUM (
    'ok',
    'bad_qr',
    'not_enrolled',
    'session_closed',
    'out_of_range',
    'already_present'
);


--
-- Name: attendance_method; Type: TYPE; Schema: api; Owner: -
--

CREATE TYPE api.attendance_method AS ENUM (
    'qr',
    'manual'
);


--
-- Name: attendance_status; Type: TYPE; Schema: api; Owner: -
--

CREATE TYPE api.attendance_status AS ENUM (
    'present',
    'excused'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- PostgreSQL database dump complete
--

\unrestrict le0ugOQcP7HhZj3LePoxvWvN0sjfbOxK4UbcpVLGeC7eA61bN9UEUBa85z2lttF

--
-- PostgreSQL database dump
--

\restrict KdhMlnfNqgpi2Du4gMn7EfM71XbDCiVWKPNEajq1k25M1ZLOBc95oge6t0QdhLU

-- Dumped from database version 16.10 (Debian 16.10-1.pgdg12+1)
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.schema_migrations (version) VALUES ('20261011174752');


--
-- PostgreSQL database dump complete
--

\unrestrict KdhMlnfNqgpi2Du4gMn7EfM71XbDCiVWKPNEajq1k25M1ZLOBc95oge6t0QdhLU

