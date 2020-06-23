import * as AssistantV1 from 'ibm-watson/assistant/v1';
import { IamAuthenticator } from 'ibm-watson/auth';
import { ServiceProvider } from '../service-providers/service-provider.entity';
import { WatsonCredentials, WatsonServiceData } from './watson-interfaces';
import { Observable, of, from } from 'rxjs';
import { map, switchMap, concatMap, toArray} from 'rxjs/operators';
import { Project, UtterancePart } from '../projects/project.entity';
import { Logger } from '@nestjs/common';
import { states } from './states';

export const sysEntitiesDict = {
    '@sys.geo-city': '@sys-location',
    '@sys.number': '@sys-number',
    '@sys.person': '@sys-person',
    '@sys.geo-state': '@state',
    '@sys.date-time': '@sys-date',
};

export interface  WatsonPublishingJob {
    projectId: string;
    serviceProviderId: string;
    workspace: {
        id?: string,
        name: string,
        description: string,
        language: string,
    };
    startedOn: Date;
    completedOn?: Date;
    errors?: any[];
}

export class WatsonService {
    assistant: AssistantV1;

    constructor(private serviceProvider: ServiceProvider) {
        const credentials = this.serviceProvider.credentials as WatsonCredentials;
        this.assistant = new AssistantV1({
            authenticator: new IamAuthenticator({apikey: credentials.apiKey}),
            url: credentials.url,
            version: '2020-04-01',
        });
    }

    sync(): Promise<WatsonServiceData> {
        return this.getWorkSpaces().pipe(
            switchMap((workSpaces) => from(workSpaces)),
            concatMap(workspace => this.getWorkspace(workspace.workspace_id, true)),
            toArray(),
            map((workspaces) => {
                return {
                    workspaces,
                    lastUpdated: new Date(),
                };
            }),
        ).toPromise();
    }

    getWorkSpaces(): Observable<AssistantV1.Workspace[]> {
        return from(this.assistant.listWorkspaces({
            includeAudit: true,
        }))
        .pipe(
            map((res) => {
                if (res.status === 200) {
                    return res.result.workspaces;
                } else {
                    throw new Error(res.statusText);
                }
            }),
        );
    }

    getWorkspace(workspaceId: string, _export: boolean): Observable<AssistantV1.Workspace> {
        Logger.debug(`Fetching ${workspaceId}`);
        return from(this.assistant.getWorkspace({
            workspaceId,
            _export,
        })).pipe(
            map((res) => {
                if (res.status === 200) {
                    return res.result;
                } else {
                    throw new Error(res.statusText);
                }
            }),
        );
    }

    async publish(project: Project, publishingJob: WatsonPublishingJob) {
        const workspace = {} as AssistantV1.Workspace;
        workspace.name = publishingJob.workspace.name;
        workspace.description = publishingJob.workspace.description || '';
        workspace.language = publishingJob.workspace.language || 'en';
        workspace.system_settings = {
            system_entities: {
                enabled: true,
            },
        };
        workspace.intents = this.generateIntents(project);
        workspace.entities = [
            ...this.generateEntities(project),
            ...this.generateSystemEntities(),
        ];
        workspace.dialog_nodes = this.generateDialogNodes(project);
        workspace.webhooks = [{
            name: 'main',
            url: project.fulfillmentUrl,
        } as AssistantV1.Webhook];
        if (publishingJob.workspace.id) {
            return this.assistant.updateWorkspace({
                workspaceId: publishingJob.workspace.id,
                systemSettings: {
                    system_entities: {
                        enabled: true,
                    },
                },
                entities: workspace.entities,
                intents: workspace.intents,
                dialogNodes: workspace.dialog_nodes,
                webhooks: workspace.webhooks,
            }).catch((err: Error) => {
                Logger.debug(err);
            });
        } else {
            return this.assistant.createWorkspace(workspace).catch((err: Error) => {
                Logger.debug(err);
            });
        }
        // return workspace;
    }

    generateEntities(project: Project): AssistantV1.Entity[] {
        return project.customEntities.map((entity) => {
            return {
                entity: entity.entityType.replace('@', ''),
                description: entity.description,
                metadata: {
                    id: entity.id,
                },
                fuzzy_match: entity.fuzzyMatching,
                values: [
                    ...Object.keys(entity.dictionary || {}).map((dic) => {
                        return {
                            value: dic,
                            type: 'synonyms',
                            synonyms: entity.dictionary[dic],
                        };
                    }),
                    ...Object.keys(entity.patterns || {}).map((pat) => {
                        return {
                            value: pat,
                            type: 'patterns',
                            patterns: entity.patterns[pat],
                        };
                    }),
                ],
            };
        });
    }

    generateSystemEntities(): AssistantV1.Entity[] {
        return [
            {
                entity: 'location',
                description: 'filling for inline system entities',
                fuzzy_match: false,
            },
            {
                entity: 'state',
                description: 'filling for inline system entities',
                fuzzy_match: true,
                values: states.map((entry) => {
                    return {
                        value: entry.State,
                        type: 'synonyms',
                        synonyms: [entry.State],
                    };
                }),
            },
            {
                entity: 'number',
                description: 'filling for inline system entities',
                fuzzy_match: false,
                values: [{
                    value: 'number',
                    type: 'patterns',
                    patterns: ['^[0-9]*$'],
                }],
            },
            {
                entity: 'date',
                description: 'filling for inline system entities',
                fuzzy_match: false,
                values: [{
                    value: 'date',
                    type: 'patterns',
                    patterns: [
                        '^\d{1,2}\/\d{1,2}\/\d{4}$',
                    ],
                }],
            }] as AssistantV1.Entity[];
    }

    generateIntents(project: Project): AssistantV1.Intent[] {
        return project.intents.map((intent) => {
            return {
                intent: intent.id,
                description: intent.description,
                examples: intent.utterances.map((utterance) => {
                    let positionTrack = 0;
                    return {
                        text: utterance.parts.reduce((acc, part) => {
                            return {text: acc.text + part.text} as UtterancePart;
                        }).text,
                        mentions: utterance.parts.map((part) => {
                            if (part.entityType) {
                                return {
                                    entity: this.convertEntityType(part.entityType).replace('@', '').replace('sys-', ''),
                                    location: [positionTrack, positionTrack + part.text.length],
                                } as AssistantV1.Mention;
                            }
                            positionTrack += part.text.length;
                        }).filter((v) => v),
                    };
                }),
            };
        });
    }

    generateDialogNodes(project: Project): AssistantV1.DialogNode[] {
        const dialogNodes = [] as AssistantV1.DialogNode[];
        let previousFrameNode: AssistantV1.DialogNode = null;
        project.intents.forEach((intent) => {
            const frameNode = {
                type: AssistantV1.CreateDialogNodeConstants.Type.FRAME,
                dialog_node: `${intent.id}_frame`,
                title: `${intent.id}_dialog`,
                conditions: `#${intent.id}`,
                actions: [],
                metadata: {
                    _customization: {
                        mcr: true,
                    },
                },
                previous_sibling: (previousFrameNode) ? previousFrameNode.dialog_node : null,
            } as AssistantV1.DialogNode;
            previousFrameNode = frameNode;

            let previousSlotNode: AssistantV1.DialogNode = null;
            const webhookParameters: any = {};
            intent.parameters.forEach((param) => {
                const paramId = param.id.replace(/-/g, '_');
                const slotNode = {
                    type: AssistantV1.CreateDialogNodeConstants.Type.SLOT,
                    dialog_node: `${paramId}_${intent.id}`,
                    parent: frameNode.dialog_node,
                    variable: paramId,
                    previous_sibling: (previousSlotNode) ? previousSlotNode.dialog_node : null,
                } as AssistantV1.DialogNode;
                webhookParameters[slotNode.variable] = `$${slotNode.variable}`;
                dialogNodes.push(slotNode);
                previousSlotNode = slotNode;

                const inputHandlerNode = {
                    type: AssistantV1.CreateDialogNodeConstants.Type.EVENT_HANDLER,
                    dialog_node: `input_handler_${paramId}_${intent.id}`,
                    output: {},
                    parent: slotNode.dialog_node,
                    context: {
                        [slotNode.variable]: `${this.convertEntityType(param.entityType)}`,
                    },
                    conditions: `${this.convertEntityType(param.entityType)}`,
                    event_name: AssistantV1.CreateDialogNodeConstants.EventName.INPUT,
                } as AssistantV1.DialogNode;
                dialogNodes.push(inputHandlerNode);

                if (param.mandatory) {
                    const focusHandlerNode = {
                        type: AssistantV1.CreateDialogNodeConstants.Type.EVENT_HANDLER,
                        dialog_node: `focus_handler_${paramId}_${intent.id}`,
                        output: {
                            text: {
                                values: [
                                    `What is the ${param.friendlyName}?`,
                                    `please provide the ${param.friendlyName}`,
                                ],
                                selection_policy: 'random',
                            },
                        },
                        parent: inputHandlerNode.dialog_node,
                        event_name: AssistantV1.CreateDialogNodeConstants.EventName.FOCUS,
                        previous_sibling: inputHandlerNode.dialog_node,
                    } as AssistantV1.DialogNode;
                    dialogNodes.push(focusHandlerNode);

                    const filledHandlerNode = {
                        type: AssistantV1.CreateDialogNodeConstants.Type.EVENT_HANDLER,
                        dialog_node: `filled_handler_${paramId}_${intent.id}`,
                        output: {
                            text: {
                                values: ['thank you'],
                                selection_policy: 'sequential',
                            },
                        },
                        parent: slotNode.dialog_node,
                        conditions: param.entityType,
                        event_name: AssistantV1.CreateDialogNodeConstants.EventName.FILLED,
                        previous_sibling: focusHandlerNode.dialog_node,
                    } as AssistantV1.DialogNode;
                    dialogNodes.push(filledHandlerNode);

                    const noMatchHandlerNode = {
                        type: AssistantV1.CreateDialogNodeConstants.Type.EVENT_HANDLER,
                        dialog_node: `no_match_handler_${paramId}_${intent.id}`,
                        output: {
                            text: {
                                values: [`sorry, I cannot proceed without the ${param.friendlyName}`],
                                selection_policy: 'sequential',
                            },
                        },
                        parent: slotNode.dialog_node,
                        event_name: AssistantV1.CreateDialogNodeConstants.EventName.NOMATCH,
                        previous_sibling: filledHandlerNode.dialog_node,
                    } as AssistantV1.DialogNode;
                    dialogNodes.push(noMatchHandlerNode);
                }
            });

            const responseConditionSuccess: AssistantV1.DialogNode = {
                type: AssistantV1.CreateDialogNodeConstants.Type.RESPONSE_CONDITION,
                output: {
                    generic: [
                        {
                            values: [
                                {text: intent.responseTemplates[0].replace(/result-slot-/g, 'webhook_result.result_slot_')},
                            ],
                            response_type: 'text',
                            selection_policy: 'sequential',
                        },
                    ],
                },
                parent: frameNode.dialog_node,
                conditions: '$webhook_result',
                dialog_node: `response_success_${intent.id}`,
                previous_sibling: (previousSlotNode) ? previousSlotNode.dialog_node : null,
            };
            dialogNodes.push(responseConditionSuccess);

            const responseConditionFailure: AssistantV1.DialogNode = {
                type: AssistantV1.CreateDialogNodeConstants.Type.RESPONSE_CONDITION,
                parent: frameNode.dialog_node,
                conditions: 'anything_else',
                output: {
                    generic: [
                        {
                            values: [
                                {text: 'sorry unable to process your query.'},
                            ],
                            response_type: 'text',
                            selection_policy: 'sequential',
                        },
                    ],
                },
                dialog_node: `response_failure_${intent.id}`,
                previous_sibling: responseConditionSuccess.dialog_node,
            };
            dialogNodes.push(responseConditionFailure);

            webhookParameters.intent = intent.id;
            webhookParameters.fulfillmentText = intent.responseTemplates[0];

            frameNode.actions = [{
                name: 'main',
                type: 'webhook',
                parameters: webhookParameters,
                result_variable: 'webhook_result',
            }];
            dialogNodes.push(frameNode);
        });
        return dialogNodes;
    }

    convertEntityType = (entityType: string) =>
        (entityType.startsWith('@sys') ? sysEntitiesDict[entityType] : entityType)

    formatRequest(reqBody: any) {
        let intentId: string;
        let fulfillmentText: string;
        const params = {};
        Object.keys(reqBody).forEach((key) => {
            if (key === 'intent') {
                intentId = `${reqBody[key]}`;
            }
            if (key === 'fulfillmentText') {
                fulfillmentText = reqBody[key];
            }
            if (key.startsWith('slot')) {
                const paramName = key.replace(/_/g, '-');
                params[paramName] = reqBody[key];
            }
        });
        return {
            intent_id: intentId,
            slot_values: params,
            response_template: fulfillmentText,
          };
    }
}
