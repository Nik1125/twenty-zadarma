// Builds a cURL command for the AI enrichment endpoint that can be pasted
// into n8n's "Import cURL" feature on an HTTP Request node. n8n parses the
// curl into URL/method/headers/body fields automatically.
//
// n8n's importer does NOT understand `{{ }}` expressions — it imports them as
// literal strings. So we use simple `<placeholder>` markers that the user
// then replaces with n8n expressions in the node UI. The full Retell field
// mapping lives in docs/AI_ENRICHMENT.md.

export const buildEnrichmentCurl = (endpointUrl: string): string => {
  const body = {
    match: {
      correlationId: '<call_id>',
      fromNumber: '<from_number>',
      toNumber: '<to_number>',
      startTimestamp: '<start_timestamp_ms>',
    },
    data: {
      aiVendor: 'retell',
      aiAgentName: '<agent_name>',
      aiSentiment: 'NEUTRAL',
      aiSuccessful: true,
      aiTransferred: false,
      aiCost: { amountMicros: 0, currencyCode: 'USD' },
      aiSummary: '<summary>',
      aiTranscript: '<transcript>',
      recordingUrl: '<recording_url>',
      aiInterestLevel: 4,
      aiActionRequired: 'OPERATOR_TASK',
      aiActionContext: '<action_context>',
      aiKeyTopics: ['<topic_1>', 'objection:<reason>'],
    },
  };
  // JSON.stringify outputs valid JSON with double-quoted keys/strings — pasteable
  // verbatim. We single-quote-wrap the whole `-d` arg, which works because
  // JSON.stringify uses double quotes only.
  const bodyJson = JSON.stringify(body);
  return [
    `curl -X POST '${endpointUrl}' \\`,
    `  -H 'Authorization: Bearer YOUR_WORKSPACE_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${bodyJson}'`,
  ].join('\n');
};
