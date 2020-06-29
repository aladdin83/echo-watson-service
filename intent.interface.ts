export interface UtterancePart {
    text: string;
    alias: string;
    entityType: string;
}

export interface IntentParam {
    id: string;
    mandatory: boolean;
    entityType: string;
    friendlyName: string;
}

export interface Intent {
    id: string;
    utterances: [
        {parts: UtterancePart[]}
    ];
    followupUtterances: [
        {parts: UtterancePart[]}
    ];
    responseTemplates: [];
    parameters: [];
}
