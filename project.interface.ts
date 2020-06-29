import { BaseEntity } from '../../core/common/base-entity.interface';
import { CustomEntity } from './entity.interface';
import { Intent } from './intent.interface';
import { ServiceProvider } from '../service-providers/service-provider.interface';

export interface Project extends BaseEntity {
    name: string;
    originalSchema: any;
    customEntities: CustomEntity[];
    intents: Intent[];
    serviceProvider: ServiceProvider;
    fulfillmentUrl: string;
}
