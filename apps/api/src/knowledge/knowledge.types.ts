import type { SearchKnowledgeDto } from './knowledge.dto';
export interface KnowledgeSearchResult {
  reference: string;
  version: number;
  title: string;
  category: string;
  excerpt: string;
  relevanceScore: number;
}
export interface KnowledgeSearchResponse {
  knowledgeFound: boolean;
  results: KnowledgeSearchResult[];
}
export interface KnowledgeRetriever {
  search(input: SearchKnowledgeDto): Promise<KnowledgeSearchResponse>;
}
export const KNOWLEDGE_RETRIEVER = Symbol('KNOWLEDGE_RETRIEVER');
