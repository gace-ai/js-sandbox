export class DOMRegistry {
    private nodeRegistry = new Map<number, WeakRef<Node>>();
    private reverseRegistry = new WeakMap<Node, number>();
    private nextNodeId = 1;

    constructor() {
        // Node 0 is always the document
        this.registerNode(window.document, 0);
    }

    public registerNode(node: Node, explicitId?: number): number {
        if (this.reverseRegistry.has(node)) {
            return this.reverseRegistry.get(node)!;
        }
        const id = explicitId !== undefined ? explicitId : this.nextNodeId++;
        this.nodeRegistry.set(id, new WeakRef(node));
        this.reverseRegistry.set(node, id);
        return id;
    }

    public getNode(id: number): Node | undefined {
        const ref = this.nodeRegistry.get(id);
        return ref?.deref();
    }

    public releaseNode(id: number): void {
        const node = this.getNode(id);
        if (node) {
            this.reverseRegistry.delete(node);
        }
        this.nodeRegistry.delete(id);
    }

    public clear(): void {
        this.nodeRegistry.clear();
        this.reverseRegistry = new WeakMap();
        this.nextNodeId = 1;
        this.registerNode(window.document, 0);
    }
}
