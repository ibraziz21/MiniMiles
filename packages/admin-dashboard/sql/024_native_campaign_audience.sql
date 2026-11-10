-- Campaigns use the existing dual-transport dispatcher; preserve marketing opt-in.
BEGIN;
CREATE OR REPLACE VIEW v_web_push_marketing_audience AS
SELECT p.hub_user_id, count(d.id)::integer AS active_device_count
FROM hub_notification_preferences p
JOIN (
 SELECT hub_user_id,id FROM web_push_subscriptions WHERE status='active'
 UNION ALL
 SELECT hub_user_id,id FROM hub_user_devices WHERE status='active' AND expo_push_token IS NOT NULL
) d ON d.hub_user_id=p.hub_user_id
WHERE p.marketing_enabled=true GROUP BY p.hub_user_id;
CREATE OR REPLACE VIEW v_web_push_campaign_delivery_stats AS
SELECT c.id,c.campaign_type,c.title,c.body,c.deep_link,c.status,c.audience_count,c.queued_count,c.created_by,c.created_at,
 count(DISTINCT n.id) FILTER(WHERE j.status='completed')::integer AS processed_recipients,
 count(DISTINCT n.id) FILTER(WHERE j.status='dead')::integer AS dead_recipients,
 count(DISTINCT n.id) FILTER(WHERE j.status='suppressed')::integer AS suppressed_recipients,
 (count(DISTINCT d.id) FILTER(WHERE d.status='accepted')+count(DISTINCT nd.id) FILTER(WHERE nd.status='accepted'))::integer AS accepted_deliveries
FROM web_push_campaigns c LEFT JOIN notification_outbox n ON n.campaign_id=c.id
LEFT JOIN web_push_jobs j ON j.notification_id=n.id
LEFT JOIN web_push_deliveries d ON d.job_id=j.id
LEFT JOIN native_push_deliveries nd ON nd.job_id=j.id GROUP BY c.id;
REVOKE ALL ON v_web_push_marketing_audience,v_web_push_campaign_delivery_stats FROM PUBLIC,anon,authenticated;
GRANT SELECT ON v_web_push_marketing_audience,v_web_push_campaign_delivery_stats TO service_role;
COMMIT;
