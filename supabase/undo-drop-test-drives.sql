-- Restore the test project to the state before the 2026-11-06 drive delete.
-- ONE file, merged from both dumps taken around that delete, so the recorded
-- facts (rounds, applications, shortlist, results, attendance) and the offer
-- row all come back together.
--
-- Target: jpejihmcbgerekyiikgb only (pms-test-gamma.vercel.app). Check the tab
-- URL before pasting. The Dashboard runs it as one transaction, so a rejected
-- row rolls the whole restore back.
--
-- parents first: drives before their children, applications before the round
-- tables that reference them. students/campuses/degrees/branches/companies/
-- company_drives were never deleted, so they are not restored here.

-- ---------------------------------------------------------------------------
-- Guard: this file only makes sense on a database with no drives
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_drives   integer;
  v_students integer;
begin
  if to_regclass('public.company_drives') is null then
    raise exception 'ABORTED: no company_drives table here, so 0116 is not applied on this database.';
  end if;

  select count(*) into v_drives   from drives;
  select count(*) into v_students from students;

  if v_drives > 0 then
    raise exception 'ABORTED: % drives already exist — this restore is for the emptied test project.', v_drives;
  end if;
  if v_students > 400 then
    raise exception 'ABORTED: % students is not the test project (204 on 2026-11-06).', v_students;
  end if;

  raise notice 'GUARD OK: 0 drives, % students — ready to restore.', v_students;
end
$guard$;

-- drives: 18 row(s)
insert into public.drives (additional_designations, application_end, application_start, approved_at, approved_by, arrears_policy, bond_details, company_drive_id, company_name, company_website, completed_reason, created_at, created_by, ctc_breakup, ctc_max_lpa, ctc_min_lpa, drive_mode, drive_type, eligible_passing_years, has_custom_targeting, id, industry, jd_file_name, jd_size_bytes, jd_storage_path, job_description, joining_immediate_notes, joining_later_notes, joining_timeline, mandatory_skills, min_overall_cgpa, min_overall_cgpa_scale, min_overall_marks, min_tenth_percentage, min_twelfth_percentage, offer_category, on_hold, on_hold_reason, open_to_all_override, open_to_all_reason, openings, published_at, published_by, rejection_reason, role_category, role_title, round_count, shift_night_timing, shift_type, spoc_designation, spoc_email, spoc_name, spoc_phone, status, stipend_max_monthly, stipend_min_monthly, tentative_date, timeline_notes, updated_at, venue, work_locations, work_type) values
  ('{}', '2026-10-30T17:51:00+00:00', '2026-10-30T12:52:00+00:00', '2026-10-30T12:48:26.255+00:00', '9e16b022-2e39-420a-a316-6eab58969f62', 'flexible', 'None', null, 'FACE Prep tst', 'https://faceprep.in/', null, '2026-10-30T12:42:19.671414+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, null, 4.5, 'virtual', 'placement', '{2026,2027}', false, '64065de6-289f-42cd-b262-302a59f05474', 'Technical', 'Kambaa - Implementation Specialist JD v1 (1).pdf', 159480, '64065de6-289f-42cd-b262-302a59f05474/jd-1793364138025-Kambaa - Implementation Specialist JD v1 (1).pdf', null, 'Test', null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 5, '2026-10-30T12:52:56.313+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, 'software_technical', 'Associate Software Engineer', 2, null, 'day', null, null, null, null, 'live', null, null, '2026-10-31', 'Test to roll out additional opportunities to existing drive.', '2026-10-30T12:42:19.671414+00:00', null, 'Chennai/Bangalore', null),
  ('{}', '2026-10-30T07:39:00+00:00', '2026-10-16T07:39:00+00:00', '2026-10-16T07:32:15.261+00:00', '0a207226-45a3-4d1f-bfbb-6bd4095aaa69', 'flexible', null, null, 'FACE Prep tst', 'https://faceprep.in/', null, '2026-10-16T07:29:52.215667+00:00', '2b7d8d14-159a-4156-8849-fb17fc41eec6', '6', 8, 5, 'on_campus', 'placement', '{2027}', false, 'ee5195c5-54af-450b-92cb-9cca8eb3cd88', null, null, null, null, 'test jd', null, null, 'immediate', null, null, 'cgpa', null, null, null, 'dream', false, null, true, 'test', 10, '2026-10-16T07:57:12.12+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', null, 'technical_support_it_ops', 'test - dev', 1, null, null, null, null, null, null, 'completed', null, null, '2026-10-30', null, '2026-10-16T07:29:52.215667+00:00', null, 'CBE', null),
  ('{}', '2026-10-30T09:08:00+00:00', '2026-10-16T09:08:00+00:00', '2026-10-16T09:06:45.998+00:00', '0a207226-45a3-4d1f-bfbb-6bd4095aaa69', 'flexible', null, null, 'FACE Prep tst', 'https://faceprep.in/', null, '2026-10-16T09:05:58.858893+00:00', '2b7d8d14-159a-4156-8849-fb17fc41eec6', '5', 4, 3, 'on_campus', 'placement', '{2026,2027,2028}', false, '4ff6b97a-3068-4e27-8f6a-f3dfd0378297', null, null, null, null, 'test', null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, true, 'test', 3, '2026-10-16T09:08:54.485+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', null, 'software_technical', 'test - dev', 1, null, 'day', null, null, null, null, 'live', null, null, '2026-10-16', null, '2026-10-16T09:05:58.858893+00:00', null, 'CBE', null),
  ('{}', '2026-11-05T10:38:00+00:00', '2026-11-04T10:38:00+00:00', '2026-11-02T11:15:41.319+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', 'None', '6f76795e-c073-48d6-a0b6-9bb86fa467a0', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-10-31T13:01:48.690826+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'Great Congratulations to Kavin E S', 5, 3, 'virtual', 'placement', '{2026,2027,2028}', false, '83f89f01-0f09-47ee-b1f3-15ac332caaa9', 'Technical and Non Technical', null, null, null, 'Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S', null, null, 'immediate', 'AI skills, Aptitude, Data Structures and Algorithms, GitHub strength, Testing, AI-assisted Full Stack Development, Communication skills, Fundamentals of Programming, Programming skills', null, 'cgpa', 7, null, null, 'regular', false, null, false, null, 4, '2026-11-04T10:38:38.544+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, 'technical_support_it_ops', 'Tech support', 3, null, 'day', null, null, null, null, 'live', null, null, '2026-11-03', 'Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S', '2026-10-31T13:01:48.690826+00:00', null, 'Chennai', null),
  ('{}', '2026-11-06T11:34:00+00:00', '2026-11-05T11:34:00+00:00', '2026-11-05T11:30:20.113+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'b81b52a0-dbe8-484e-a2db-45a44221b8eb', 'FACE Prep tst', 'https://faceprep.in/', null, '2026-11-05T11:29:21.549713+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 2.5, 'virtual', 'placement', '{2026,2027,2028}', false, 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a', 'Technical', null, null, null, 'mnbvasdfghjk', null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 10, '2026-11-05T11:34:43.828+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'software_technical', 'technical mentor', 1, null, 'day', null, null, null, null, 'live', null, null, '2026-11-05', 'nil', '2026-11-05T11:29:21.549713+00:00', null, 'coimbatore', null),
  ('{}', '2026-11-08T11:37:00+00:00', '2026-11-05T11:37:00+00:00', '2026-10-15T04:22:36.804+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', 'flexible', null, null, 'FACE Prep tst', 'https://faceprep.in/', null, '2026-10-14T13:40:04.638022+00:00', '2b7d8d14-159a-4156-8849-fb17fc41eec6', null, null, 3, 'on_campus', 'placement', '{2027,2028}', false, 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96', null, 'Dashboard (1).pdf', 382397, 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96/jd-1791985202085-Dashboard (1).pdf', 'We are looking for a detail-oriented Web Developer to help design, develop, and maintain high-performing websites and digital experiences. You will work closely with UI/UX designers, project managers, and stakeholders to turn wireframes and concepts into functional, responsive web applications', '30 days', null, 'immediate', 'AI skills, Data Structures and Algorithms, GitHub strength, AI-assisted Full Stack Development, Fundamentals of Programming, Programming skills', null, 'cgpa', null, null, null, 'regular', false, null, false, null, 3, '2026-11-05T11:37:51.752+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'technical_support_it_ops', 'Web Dev', 3, null, 'day', null, null, null, null, 'live', null, null, '2026-10-21', null, '2026-10-14T13:40:04.638022+00:00', null, 'CBE', null),
  ('{}', '2026-11-06T11:35:00+00:00', '2026-11-05T11:35:00+00:00', '2026-11-05T11:30:24.276+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'b81b52a0-dbe8-484e-a2db-45a44221b8eb', 'FACE Prep tst', 'https://faceprep.in/', null, '2026-11-05T11:29:21.549713+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 2.5, 'virtual', 'placement', '{2026,2027,2028}', false, '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d', 'Technical', null, null, null, 'mnbvasdfghjk', null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 10, '2026-11-05T11:36:09.311+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'technical_support_it_ops', 'technical mentor', 1, null, 'day', null, null, null, null, 'live', null, null, '2026-11-05', 'nil', '2026-11-05T11:29:21.549713+00:00', null, 'coimbatore', null),
  ('{}', null, null, null, null, 'flexible', null, 'b96e1235-d7d7-4293-9509-841a55ac4a03', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-11-05T11:54:30.506726+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 2.42, 'virtual', 'placement', '{2026,2027,2028}', false, 'e4137741-0b5e-452c-9777-83d2bf44e88c', 'Technical and Non Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, null, false, null, false, null, 10, null, null, null, 'technical_support_it_ops', 'technical mentor', 1, null, 'day', null, null, null, null, 'submitted', null, null, '2026-11-05', null, '2026-11-05T11:54:30.506726+00:00', null, 'coimbatore', null),
  ('{}', null, null, '2026-11-05T12:11:14.096+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'b96e1235-d7d7-4293-9509-841a55ac4a03', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-11-05T11:54:30.506726+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 2.42, 'virtual', 'placement', '{2026,2027,2028}', false, '6f4a2a7e-29b6-4032-93bc-11e2880922dd', 'Technical and Non Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, null, false, null, false, null, 10, null, null, 'Test Rejection', 'software_technical', 'technical mentor', 1, null, 'day', null, null, null, null, 'rejected', null, null, '2026-11-05', null, '2026-11-05T11:54:30.506726+00:00', null, 'coimbatore', null),
  ('{}', null, null, null, null, 'flexible', null, 'fe6495bb-b698-4a87-b902-26e871135095', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-11-05T12:12:05.218193+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 3.5, 'virtual', 'placement', '{2026,2027,2028}', false, 'd34f4c95-f0b8-4ca6-809f-265d61551755', 'Technical and Non Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, null, false, null, false, null, 10, null, null, null, 'software_technical', 'technical mentor', 1, null, 'day', null, null, null, null, 'submitted', null, null, '2026-11-05', null, '2026-11-05T12:12:05.218193+00:00', null, 'coimbatore', null),
  ('{}', null, null, '2026-11-06T07:19:57.387+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, '7d50d461-e8de-4fcc-80ee-5f80239f1bfa', 'FACE Prep tst', 'https://faceprep.in/', null, '2026-11-06T06:42:42.355609+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 2.6, 'virtual', 'placement', '{2026,2027,2028}', false, '64461f38-46f6-430e-a993-8a470652c243', 'Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, null, false, null, false, null, 10, null, null, 'Rejected since LPA less than 3LPA', 'software_technical', 'technical mentor', 1, null, 'day', null, null, null, null, 'rejected', null, null, '2026-11-06', null, '2026-11-06T06:42:42.355609+00:00', null, 'coimbatore', null),
  ('{}', null, null, '2026-11-06T07:20:05.793+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, '7d50d461-e8de-4fcc-80ee-5f80239f1bfa', 'FACE Prep tst', 'https://faceprep.in/', null, '2026-11-06T06:42:42.355609+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 5.6, 'virtual', 'placement', '{2026,2027,2028}', false, 'eb7f1749-8847-42e5-ad6e-c9617fd3c14d', 'Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, 'dream', false, null, false, null, 10, null, null, null, 'technical_support_it_ops', 'associate', 1, null, 'day', null, null, null, null, 'approved', null, null, '2026-11-06', null, '2026-11-06T06:42:42.355609+00:00', null, 'Remote + Delhi', null),
  ('{}', null, null, '2026-11-06T07:20:12.567+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'fe6495bb-b698-4a87-b902-26e871135095', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-11-05T12:12:05.218193+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 3.5, 'virtual', 'placement', '{2026,2027,2028}', false, '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd', 'Technical and Non Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 10, null, null, null, 'digital_marketing', 'technical mentor', 1, null, 'day', null, null, null, null, 'approved', null, null, '2026-11-05', null, '2026-11-05T12:12:05.218193+00:00', null, 'coimbatore', null),
  ('{}', null, null, '2026-11-06T07:20:26.258+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'fe6495bb-b698-4a87-b902-26e871135095', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-11-05T12:12:05.218193+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 3.5, 'virtual', 'placement', '{2026,2027,2028}', false, '1d3e878b-3e8c-468c-8a83-7a3fee8f113c', 'Technical and Non Technical', null, null, null, null, null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 10, null, null, null, 'technical_support_it_ops', 'technical mentor', 1, null, 'day', null, null, null, null, 'approved', null, null, '2026-11-05', null, '2026-11-05T12:12:05.218193+00:00', null, 'coimbatore', null),
  ('{}', '2026-11-07T11:36:00+00:00', '2026-11-05T11:36:00+00:00', '2026-11-02T10:55:59.733+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', 'None', '6f76795e-c073-48d6-a0b6-9bb86fa467a0', 'test pms', 'https://www.mayuraconsultancy.com', null, '2026-10-31T13:01:48.690826+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 4.9, 3, 'virtual', 'placement', '{2026,2027,2028}', false, 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9', 'Technical and Non Technical', null, null, null, 'Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S', null, null, 'immediate', 'AI skills, Aptitude, Data Structures and Algorithms, GitHub strength, Testing, AI-assisted Full Stack Development, Communication skills, Fundamentals of Programming, Programming skills', 7, 'cgpa', 7, null, null, 'regular', false, null, false, null, 3, '2026-11-05T11:36:59.782+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'software_technical', 'Front End Developer', 3, null, 'day', null, null, null, null, 'live', null, null, '2026-11-03', 'Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S Great Congratulations to Kavin E S', '2026-10-31T13:01:48.690826+00:00', null, 'Remote', 'work_from_home'),
  ('{}', '2026-11-08T10:29:00+00:00', '2026-11-06T10:29:00+00:00', '2026-11-06T10:24:52.7+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'f7f7c9ed-296f-403e-956c-9fb8057417c8', 'Focus4D', 'https://faceprep.in/', null, '2026-11-06T10:13:55.666585+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 3.3, 'virtual', 'internship_convertible', '{2026,2027,2028}', false, '7bc64ef4-1880-43c7-90ee-2ecb1dd64106', 'Technical and Non Technical', 'ShakthiM_Naas_offerletter.pdf', 205874, '7bc64ef4-1880-43c7-90ee-2ecb1dd64106/jd-1793960034662-ShakthiM_Naas_offerletter.pdf', null, null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 4, '2026-11-06T10:29:39.347+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'technical_support_it_ops', 'associate', 1, null, 'day', null, null, null, null, 'live', null, 25000, null, null, '2026-11-06T10:13:55.666585+00:00', null, 'Chennai', 'work_from_office'),
  ('{}', '2026-11-07T10:28:00+00:00', '2026-11-06T10:28:00+00:00', '2026-11-06T10:25:16.543+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'f7f7c9ed-296f-403e-956c-9fb8057417c8', 'Focus4D', 'https://faceprep.in/', null, '2026-11-06T10:13:55.666585+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, null, 'virtual', 'internship', '{2026,2027,2028}', false, 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a', 'Technical and Non Technical', 'offerletter_RamKumar B_Cogent_Selfoffer.pdf', 381308, 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a/jd-1793960034662-offerletter_RamKumar B_Cogent_Selfoffer.pdf', null, null, null, 'immediate', null, null, 'cgpa', null, null, null, 'internship', false, null, false, null, 14, '2026-11-06T10:28:36.846+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'software_technical', 'Data science', 1, null, 'day', null, null, null, null, 'live', null, 15000, null, null, '2026-11-06T10:13:55.666585+00:00', null, 'coimbatore', 'hybrid'),
  ('{}', '2026-11-08T10:30:00+00:00', '2026-11-06T10:30:00+00:00', '2026-11-06T10:24:30.684+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', 'flexible', null, 'f7f7c9ed-296f-403e-956c-9fb8057417c8', 'Focus4D', 'https://faceprep.in/', null, '2026-11-06T10:13:55.666585+00:00', '0ccd35d1-96a7-430a-93a7-b55e5ae8a36f', null, null, 4.4, 'virtual', 'placement', '{2026,2027,2028}', false, '9edd8c2a-4dc5-486e-a792-a2875f5e6d13', 'Technical and Non Technical', 'Janani G_Charis_offer letter.pdf', 70669, '9edd8c2a-4dc5-486e-a792-a2875f5e6d13/jd-1793960034662-Janani G_Charis_offer letter.pdf', 'Figma tool', null, null, 'immediate', null, null, 'cgpa', null, null, null, 'regular', false, null, false, null, 10, '2026-11-06T10:30:42.309+00:00', '6c5dfe26-3f6a-4e59-9657-dee75d88a3df', null, 'digital_marketing', 'Designer', 1, null, 'day', null, null, null, null, 'live', null, null, null, null, '2026-11-06T10:13:55.666585+00:00', null, 'coimbatore', 'work_from_home');

-- drive_rounds: 26 row(s)
insert into public.drive_rounds (advance_proof_path, created_at, drive_id, id, instructions, name, online_link, round_interview_link, round_mode, round_scheduled_at, scheduled_at, sequence, venue) values
  (null, '2026-10-16T07:57:11.77921+00:00', 'ee5195c5-54af-450b-92cb-9cca8eb3cd88', '768bfb9c-9aad-49d6-adb4-6eaecd036471', null, 'Direct', null, null, null, null, null, 1, null),
  (null, '2026-10-16T09:08:54.531951+00:00', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297', '1a409bf6-61da-42fb-ad89-bde2da59906a', null, 'testdeb', null, null, null, null, null, 1, null),
  (null, '2026-10-16T10:11:11.135092+00:00', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297', 'e85a9ffa-c821-4ee2-b3f1-bf60c27b1086', null, 'Test 2', null, null, null, null, null, 2, null),
  (null, '2026-10-30T12:52:55.975391+00:00', '64065de6-289f-42cd-b262-302a59f05474', 'e182fba6-1d52-40ff-961e-58d6ea57086f', null, 'Virtual', null, null, null, null, null, 1, null),
  (null, '2026-10-30T12:52:55.975391+00:00', '64065de6-289f-42cd-b262-302a59f05474', '7f92e353-4895-4353-8857-bf275365edd7', null, 'Hr Round', null, null, null, null, null, 2, null),
  (null, '2026-11-04T10:38:36.394064+00:00', '83f89f01-0f09-47ee-b1f3-15ac332caaa9', '68171585-224e-4ca9-b1b8-22797416c4c6', null, 'TBA', null, null, null, null, null, 1, null),
  (null, '2026-11-04T10:38:36.394064+00:00', '83f89f01-0f09-47ee-b1f3-15ac332caaa9', 'ebfa41b1-f205-40cc-b4c2-cf75f7ef9666', null, 'TBA', null, null, null, null, null, 2, null),
  (null, '2026-11-04T10:38:36.394064+00:00', '83f89f01-0f09-47ee-b1f3-15ac332caaa9', '6d6e8356-5bf8-4e24-a318-1de9beedf461', null, 'TBA', null, null, null, null, null, 3, null),
  (null, '2026-11-05T11:34:43.213647+00:00', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a', '671d7c17-c4dd-41f0-adff-8450141f827b', null, 'tba', null, null, null, null, null, 1, null),
  (null, '2026-11-05T11:36:08.70771+00:00', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d', '14077f67-cf4d-4213-8396-d581c30df4c2', null, 'tba', null, null, null, null, null, 1, null),
  (null, '2026-11-05T11:36:58.83108+00:00', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9', '6785fa6a-b403-4390-b54b-9331ebc3e694', null, 'TBA', null, null, null, null, null, 1, null),
  (null, '2026-11-05T11:36:58.83108+00:00', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9', '58eb44f1-be00-4ab0-974e-1ee2309f5f40', null, 'TBA', null, null, null, null, null, 2, null),
  (null, '2026-11-05T11:36:58.83108+00:00', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9', 'e60c2646-ad71-4e60-a6e1-a260add2eb0b', null, 'TBA', null, null, null, null, null, 3, null),
  (null, '2026-11-05T11:37:51.093851+00:00', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96', '64363e84-36a6-4d24-9e52-3bc753f40188', null, 'TECH', null, null, null, null, null, 1, null),
  (null, '2026-11-05T11:37:51.093851+00:00', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96', '738050ef-7433-4541-ae1c-daa32f8de47d', null, 'Aptitude', null, null, null, null, null, 2, null),
  (null, '2026-11-05T11:37:51.093851+00:00', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96', '4210d221-cef9-42b3-9755-8157e82d0fd0', null, 'GD', null, null, null, null, null, 3, null),
  (null, '2026-11-05T11:54:30.506726+00:00', '6f4a2a7e-29b6-4032-93bc-11e2880922dd', '0ce50dc8-c544-4f3b-b279-e42d092393ec', null, 'Round 1 Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-05T11:54:30.506726+00:00', 'e4137741-0b5e-452c-9777-83d2bf44e88c', '32ec3164-88e1-4d77-acfe-dc82287a5da8', null, 'Round 1 Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-05T12:12:05.218193+00:00', 'd34f4c95-f0b8-4ca6-809f-265d61551755', '7dd11f0a-3400-4765-bd9f-cf99baadcd78', null, 'Round 1 Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-05T12:12:05.218193+00:00', '1d3e878b-3e8c-468c-8a83-7a3fee8f113c', 'f1b7b8da-2eeb-4d05-91c3-22b99c908493', null, 'Round 1 Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-05T12:12:05.218193+00:00', '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd', 'cfcb75ca-e82c-46a6-81a7-6b689fcd2389', null, 'Round 1 Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-06T06:42:42.355609+00:00', '64461f38-46f6-430e-a993-8a470652c243', '9b719320-942e-4128-a7af-f1088b1bfdc8', null, 'Round 1 Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-06T06:42:42.355609+00:00', 'eb7f1749-8847-42e5-ad6e-c9617fd3c14d', 'a173a441-94a1-443b-b458-fef08e8f91af', null, 'Round 2 Technical interview', null, null, null, null, null, 1, null),
  (null, '2026-11-06T10:28:32.462676+00:00', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a', 'bcf174dd-3daf-422b-84c2-7035fd2d9c66', null, 'Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-06T10:29:36.565184+00:00', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106', 'a848597d-6ce4-4d82-84e0-f8b0fb8ab69f', null, 'Aptitude test', null, null, null, null, null, 1, null),
  (null, '2026-11-06T10:31:10.439688+00:00', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13', 'e4c2c5a6-df5c-47d9-895c-c3520e9fd04b', null, 'Aptitude test', null, null, null, null, null, 1, null);

-- drive_eligible_degrees: 30 row(s)
insert into public.drive_eligible_degrees (degree_id, drive_id) values
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', 'ee5195c5-54af-450b-92cb-9cca8eb3cd88'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', '64065de6-289f-42cd-b262-302a59f05474'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', '64065de6-289f-42cd-b262-302a59f05474'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', '64065de6-289f-42cd-b262-302a59f05474'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('86aa08d9-ab53-4f91-a907-bed5d50dac5d', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('33a509e0-0486-43bc-b5c8-f0e7481fa344', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('29d93c15-9072-4e66-a32c-6ac1260207cb', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13');

-- drive_eligible_branches: 35 row(s)
insert into public.drive_eligible_branches (branch_id, drive_id) values
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', '64065de6-289f-42cd-b262-302a59f05474'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', '64065de6-289f-42cd-b262-302a59f05474'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('3d053702-95cb-402b-9134-8d43f247d154', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('3d053702-95cb-402b-9134-8d43f247d154', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('3d053702-95cb-402b-9134-8d43f247d154', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('3d053702-95cb-402b-9134-8d43f247d154', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('3d053702-95cb-402b-9134-8d43f247d154', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('3d053702-95cb-402b-9134-8d43f247d154', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('3d053702-95cb-402b-9134-8d43f247d154', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('f7ecea63-34c8-4b4a-a5d0-de9806188472', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('aa585806-fbe2-4929-9690-c47528d8a146', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('ce3c7b47-1aee-441e-b990-e1144a1ccf1c', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('3d053702-95cb-402b-9134-8d43f247d154', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13');

-- drive_target_campuses: 94 row(s)
insert into public.drive_target_campuses (campus_id, drive_id) values
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', 'ee5195c5-54af-450b-92cb-9cca8eb3cd88'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', '64065de6-289f-42cd-b262-302a59f05474'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', '64065de6-289f-42cd-b262-302a59f05474'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', '64065de6-289f-42cd-b262-302a59f05474'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', '83f89f01-0f09-47ee-b1f3-15ac332caaa9'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', 'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', 'b63bceb5-bb14-46bf-9a09-1542b1e34c6a'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', '7bc64ef4-1880-43c7-90ee-2ecb1dd64106'),
  ('b9c13239-d1ab-43c5-bc67-8d2631c7ab32', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('0af927d5-2891-4f71-820d-ac3c3ee2a205', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('858dfcde-961a-4c85-a0fb-38708b08dda9', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('6a59150e-3ea9-4c71-bffa-e7880d3cb301', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('0fb40c10-4efc-4fad-a573-67fa7dd07569', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('5ae7becf-a3f3-40dd-aa2d-10123eabdf4d', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('e5d54a35-1c48-4b03-af48-411a9f0c3f10', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('7397ae0a-fe6f-4649-9c00-480fb3188abc', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('791aad12-3476-4a12-a2fb-091e5a4578de', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('bed42c07-5932-4f58-96b2-e1ceb7c6f2cf', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'),
  ('0d68a4d7-65e0-4bfa-9c2d-c280d2d8e909', '9edd8c2a-4dc5-486e-a792-a2875f5e6d13');

-- drive_contacts: 4 row(s)
insert into public.drive_contacts (designation, drive_id, email, name, phone, sequence) values
  ('tech', 'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9', 'thanush@faceprep.in', 'Thanush', '1234567890', 1),
  ('tech', '83f89f01-0f09-47ee-b1f3-15ac332caaa9', 'thanush@faceprep.in', 'Thanush', '1234567890', 1),
  ('Content Specialist', 'a8afca23-75ac-4a75-826d-dc6cd2b8a76a', 'thanushkrishna13@gmail.com', 'Mounika', '1234567890', 1),
  ('Content Specialist', '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d', 'thanushkrishna13@gmail.com', 'Mounika', '1234567890', 1);

-- recruiter_exports: 1 row(s)
insert into public.recruiter_exports (columns, drive_id, exported_at, exported_by, id, student_count) values
  ('{"Roll number","Name","Email","Degree","Branch","Passing year","Overall CGPA","10th %","12th %","Standing arrears","Arrear history","Technical skills","Resume link"}', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297', '2026-10-18T06:09:54.4522+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', 'f1b1c580-217b-4e0e-9510-4f6e000413ba', 1);

-- student_documents: 1 row(s)
insert into public.student_documents (drive_id, id, kind, role_category, size_bytes, storage_path, student_id, uploaded_at) values
  ('4ff6b97a-3068-4e27-8f6a-f3dfd0378297', '95d63c5c-029a-4e79-a507-cfd4ad15de32', 'resume', 'software_technical', 521624, '93e5ca6d-7b1e-45b5-961a-684f48c825ee/4ff6b97a-3068-4e27-8f6a-f3dfd0378297-1792145287449-TNPSC APPLICATION.pdf', '93e5ca6d-7b1e-45b5-961a-684f48c825ee', '2026-10-16T10:08:08.532673+00:00');

-- applications: 2 row(s)
insert into public.applications (applied_at, drive_id, id, profile_snapshot, resume_id, student_id) values
  ('2026-10-16T10:08:09.111901+00:00', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297', 'e6f72eb5-3689-4bbb-9096-ddfa5144590d', '{"profile":{"id":"93e5ca6d-7b1e-45b5-961a-684f48c825ee","email":"kanishka152004@gmail.com","branch":"","degree":"MCA","offers":[],"fullName":"kanishka","academics":{"city":"coimbatore","branch":"","campus":"KG-Test","degree":"MCA","overallCgpa":8.5,"passingYear":2026,"currentArrears":0,"tenthPercentage":90,"historyOfArrears":0,"twelfthPercentage":85},"srfStatus":"srf_approved","rollNumber":"1","overallCgpa":8.5,"passingYear":2026,"resumeNames":{"technical_support_it_ops":"profile-technical_support_it_ops-10cb16bc-633d-4157-9062-c80ada87530b-APTITUDE ASSIGNMENT.pdf"},"currentArrears":0,"roleCategories":["technical_support_it_ops"],"technicalSkills":"python","tenthPercentage":90,"historyOfArrears":0,"twelfthPercentage":85,"participationStatus":"active","driveTypePreferences":["internship_convertible"]},"resumeId":"95d63c5c-029a-4e79-a507-cfd4ad15de32"}', '95d63c5c-029a-4e79-a507-cfd4ad15de32', '93e5ca6d-7b1e-45b5-961a-684f48c825ee'),
  ('2026-11-04T10:41:40.685734+00:00', '83f89f01-0f09-47ee-b1f3-15ac332caaa9', 'deba7ee1-0365-4a54-961c-ff7175a5c11c', '{"profile":{"id":"e3558300-e8c9-4238-acab-5287d7dc1668","email":"radhikacmsai@gmail.com","branch":"Computer Science with Artificial Intelligence","degree":"B.Sc","offers":[],"fullName":"Radhika C M","academics":{"city":"Chennai","branch":"Computer Science with Artificial Intelligence","campus":"SDNB Vaishnav College for Women","degree":"B.Sc","overallCgpa":9,"passingYear":2027,"currentArrears":0,"tenthPercentage":82,"historyOfArrears":0,"twelfthPercentage":86},"srfStatus":"srf_approved","rollNumber":"A123","overallCgpa":9,"passingYear":2027,"resumeNames":{"sales":"profile-sales-04ef6d4d-162d-4e42-abb5-be7093423c19-Sridhar VL Resume.pdf","digital_marketing":"profile-digital_marketing-05efe745-765c-46d3-b76e-0a10c699834f-resume 2026 (1).pdf","software_technical":"profile-software_technical-14a5595c-d58b-4a11-8ae3-83f110442ded-Rangarajan_S_Technical_CV (1).pdf","operations_business":"profile-operations_business-f58d44c7-dc2d-4a47-abdf-b835656d8a47-Sridhar VL Resume.pdf","technical_support_it_ops":"profile-technical_support_it_ops-2fb0c8eb-d42e-4c0d-a2b0-b258020a9852-resume 2026 (1).pdf"},"currentArrears":0,"roleCategories":["software_technical","technical_support_it_ops","digital_marketing","sales","operations_business"],"technicalSkills":"React, Python, Manual testing, Performance testing","tenthPercentage":82,"historyOfArrears":0,"twelfthPercentage":86,"participationStatus":"active","driveTypePreferences":[]},"resumeId":"d2e6eba9-3dfa-4ad8-b99d-619a6c42659d"}', 'd2e6eba9-3dfa-4ad8-b99d-619a6c42659d', 'e3558300-e8c9-4238-acab-5287d7dc1668');

-- shortlist_entries: 1 row(s)
insert into public.shortlist_entries (application_id, decided_at, decided_by, id, included, opt_out_override_reason, rank, rationale, score) values
  ('e6f72eb5-3689-4bbb-9096-ddfa5144590d', '2026-10-16T10:08:59.725389+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', '9dcde508-5ba4-4e9e-afd0-d99a9de12eac', true, null, 1, 'CGPA 8.5 of 10. No specific skills required for this role. No arrears. Did not list this role category as a preference.', 79);

-- round_participants: 2 row(s)
insert into public.round_participants (added_at, added_by, application_id, id, meeting_link, participant_scheduled_at, round_id) values
  ('2026-10-16T10:08:59.725389+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', 'e6f72eb5-3689-4bbb-9096-ddfa5144590d', '447300d6-443d-4c8e-bb0d-1b0fe9b442cb', null, null, '1a409bf6-61da-42fb-ad89-bde2da59906a'),
  ('2026-10-16T10:11:19.281169+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', 'e6f72eb5-3689-4bbb-9096-ddfa5144590d', 'd508c41f-84f3-454f-b825-4ca17160baf5', null, null, 'e85a9ffa-c821-4ee2-b3f1-bf60c27b1086') on conflict do nothing;
--   (round_participants: do-nothing because the triggers above may already have created these)

-- round_results: 2 row(s)
insert into public.round_results (application_id, declared_at, declared_by, id, result, round_id) values
  ('e6f72eb5-3689-4bbb-9096-ddfa5144590d', '2026-10-16T10:10:30.872333+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', 'cdca697d-425f-4a5a-a963-d990d4817baf', 'selected', '1a409bf6-61da-42fb-ad89-bde2da59906a'),
  ('e6f72eb5-3689-4bbb-9096-ddfa5144590d', '2026-10-16T10:11:30.639838+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', '951d001a-21b9-4db2-89c5-776d52da5c2a', 'selected', 'e85a9ffa-c821-4ee2-b3f1-bf60c27b1086');

-- attendance: 2 row(s)
insert into public.attendance (application_id, confirmed_by, id, marked_at, marked_by, round_id, status) values
  ('e6f72eb5-3689-4bbb-9096-ddfa5144590d', null, '3d75ade6-5dfc-4490-886b-4da43b2dd337', null, null, '1a409bf6-61da-42fb-ad89-bde2da59906a', 'scheduled'),
  ('e6f72eb5-3689-4bbb-9096-ddfa5144590d', null, '9e1cf49f-b374-4e11-b416-a513ac6a8e5b', null, null, 'e85a9ffa-c821-4ee2-b3f1-bf60c27b1086', 'scheduled') on conflict do nothing;
--   (attendance: do-nothing because the triggers above may already have created these)

-- offers: 1 row(s)
insert into public.offers (approved_at, approved_by, attachment_name, attachment_path, company_name, ctc_lpa, declared_at, declared_by, drive_id, drive_type, id, offer_category, offer_letter_id, role_title, source, stipend_monthly, student_id) values
  (null, null, 'GST Certificate-TN (1).pdf', '93e5ca6d-7b1e-45b5-961a-684f48c825ee/4ff6b97a-3068-4e27-8f6a-f3dfd0378297/1792145546113-GST Certificate-TN (1).pdf', 'FACE Prep tst', 4, '2026-10-16T10:12:09.920198+00:00', 'df7b2134-1e82-4549-b415-08f611fa8e7a', '4ff6b97a-3068-4e27-8f6a-f3dfd0378297', 'placement', 'aa75516b-630d-436d-a3e8-ebff3c7ce687', 'regular', null, 'test - dev', 'on_campus', null, '93e5ca6d-7b1e-45b5-961a-684f48c825ee');

-- Verify: these must match the counts above.
select 'drives' as table_name, count(*) from drives
union all select 'drive_rounds', count(*) from drive_rounds
union all select 'applications', count(*) from applications
union all select 'shortlist_entries', count(*) from shortlist_entries
union all select 'round_results', count(*) from round_results
union all select 'attendance', count(*) from attendance
union all select 'offers', count(*) from offers
union all select 'recruiter_exports', count(*) from recruiter_exports
union all select 'drive_target_campuses', count(*) from drive_target_campuses;
