// Builds a cURL command for the SMS send endpoint that can be pasted into
// n8n's "Import cURL" feature on an HTTP Request node. n8n parses the curl
// into URL/method/headers/body fields automatically.
//
// n8n's importer does NOT understand `{{ }}` expressions — it imports them
// as literal strings. So we use simple `<placeholder>` markers that the
// caller replaces with n8n expressions in the node UI. The four analytics
// tags (category / source / templateName / campaignId) are shown with
// realistic example values so the user sees what the endpoint accepts.

export const buildSendSmsCurl = (endpointUrl: string): string => {
  const body = {
    to: '<client_phone_e164>',
    from: '<your_zadarma_did_e164>',
    message: '<sms body, may include {{name}} variables resolved by n8n upstream>',
    personId: '<optional_person_uuid>',
    category: 'REMINDER',
    source: 'N8N',
    templateName: '<your_template_name_e_g_appointment_reminder_pl>',
    campaignId: '<optional_campaign_id>',
  };
  const bodyJson = JSON.stringify(body);
  return [
    `curl -X POST '${endpointUrl}' \\`,
    `  -H 'Authorization: Bearer YOUR_WORKSPACE_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${bodyJson}'`,
  ].join('\n');
};
