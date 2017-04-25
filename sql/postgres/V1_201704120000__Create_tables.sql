CREATE TABLE public.case_types
(
    id BIGSERIAL NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    CONSTRAINT case_types_pkey PRIMARY KEY (id),
    constraint case_types_code_uq unique (code)
);

INSERT INTO public.case_types (code, description) VALUES ('CF', 'Criminal Felony');
INSERT INTO public.case_types (code, description) VALUES ('CM', 'Criminal Misdemeanor');
INSERT INTO public.case_types (code, description) VALUES ('TR', 'Traffic Violation');

CREATE TABLE public.cases
(
    id BIGSERIAL NOT NULL,
    county text NOT NULL,
    case_number text NOT NULL,
    typeid BIGINT NOT NULL,
    year TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    CONSTRAINT cases_pkey PRIMARY KEY (id),
    CONSTRAINT fk_cases_types FOREIGN KEY (typeid)
        REFERENCES public.case_types (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    constraint case_number_uq unique (case_number, county)
);

CREATE TABLE public.parties
(
    id BIGSERIAL NOT NULL,
    caseid bigint NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    CONSTRAINT parties_pkey PRIMARY KEY (id),
    CONSTRAINT fk_parties_cases FOREIGN KEY (caseid)
        REFERENCES public.cases (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    constraint party_case_and_name_uq unique (caseid, name)
);

CREATE TABLE public.counts
(
    id BIGSERIAL NOT NULL,
    count_number text NOT NULL,
    date_of_offense date,
    description text NOT NULL,
    caseid bigint NOT NULL,
    CONSTRAINT counts_pkey PRIMARY KEY (id),
    CONSTRAINT fk_counts_cases FOREIGN KEY (caseid)
        REFERENCES public.cases (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    constraint count_case_and_number_uq unique (caseid, count_number)
);

CREATE TABLE public.dispositions
(
    id BIGSERIAL NOT NULL,
    countid bigint NOT NULL,
    partyid bigint NOT NULL,
    count_as_disposed text NULL,
    outcome text NULL,
    type text NULL,
    disposition_date date NULL,
    CONSTRAINT dispositions_pkey PRIMARY KEY (id),
    CONSTRAINT fk_dispositions_counts FOREIGN KEY (countid)
        REFERENCES public.counts (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_dispositions_parties FOREIGN KEY (partyid)
        REFERENCES public.parties (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE public.dockets
(
    id BIGSERIAL NOT NULL,
    caseid bigint NOT NULL,
    amount numeric,
    partyid bigint,
    color text NOT NULL,
    countid bigint,
    description text NOT NULL,
    code text NOT NULL,
    docket_date date NOT NULL,
    CONSTRAINT dockets_pkey PRIMARY KEY (id),
    CONSTRAINT fk_dockets_cases FOREIGN KEY (caseid)
        REFERENCES public.cases (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_dockets_counts FOREIGN KEY (countid)
        REFERENCES public.counts (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_dockets_parties FOREIGN KEY (partyid)
        REFERENCES public.parties (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE public.events
(
    id BIGSERIAL NOT NULL,
    caseid bigint NOT NULL,
    partyid bigint,
    reporter text NOT NULL,
    description text NOT NULL,
    docket text NOT NULL,
    event_date timestamp without time zone,
    CONSTRAINT events_pkey PRIMARY KEY (id),
    CONSTRAINT fk_events_cases FOREIGN KEY (caseid)
        REFERENCES public.cases (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_events_parties FOREIGN KEY (partyid)
        REFERENCES public.parties (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE public.citations
(
    id BIGSERIAL NOT NULL,
    caseid BIGINT NOT NULL,
    arresting_agency TEXT,
    location_of_offense TEXT,
    north_location TEXT,
    east_control TEXT,
    county TEXT,
    citation_number TEXT NOT NULL,
    license_class TEXT,
    license_endorsements TEXT,
    employer TEXT,
    violation_type TEXT,
    vehicle_make TEXT,
    vehicle_model TEXT,
    vehicle_body_style TEXT,
    vehicle_color TEXT,
    vehicle_tag TEXT,
    vehicle_tag_year TEXT,
    vehicle_tag_issuer TEXT,
    commercial_vehicle boolean,
    hazardous_material boolean,
    accident boolean,
    personal_injury boolean,
    property_damage boolean,
    fatality boolean,
    bond_amount numeric,
    information_date TEXT,
    comments TEXT,
    CONSTRAINT citations_pkey PRIMARY KEY (id),
    CONSTRAINT fk_citations_cases FOREIGN KEY (caseid)
        REFERENCES public.cases (id) MATCH SIMPLE
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    constraint citation_case_uq unique (caseid)
);
