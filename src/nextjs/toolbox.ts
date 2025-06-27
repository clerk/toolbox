import { ToolboxBase } from "../_backend/toolbox-base";
import type { AuthProvider, DataStore } from "../_backend/types";

class Toolbox extends ToolboxBase {
  constructor(props: {
    contextId?: string;
    store: DataStore;
    auth: AuthProvider;
  }) {
    super({ ...props });
  }

  handlers() {
    return {
      GET: this.handleGet.bind(this),
      POST: this.handlePost.bind(this),
    };
  }
}

export { Toolbox };
