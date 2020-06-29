export interface EntityDictionary {
    [key: string]: string[];
}

export interface EntityPattern {
    [key: string]: string[];
}

export interface CustomEntity {
    id: string;
    index: number;
    entityType: string;
    table: string;
    column: string;
    dictionary?: EntityDictionary;
    patterns?: EntityPattern;
    regexp: boolean;
    fuzzyMatching: boolean;
}
