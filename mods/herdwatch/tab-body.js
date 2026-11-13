import { View } from "gpui-kit";

/**
 * @typedef {object} TabBodyOwner
 * @property {() => import("./schemas.js").Element} renderTabBody
 */

/**
 * The body of the open console tab, as a retained nested view. Herdr builds it again only when its owner notifies
 * it, so a redraw of the console frame (a focus change, a change in Herdr's live data, a click outside the body)
 * costs the frame only.
 */
export class TabBody extends View {
  /** @param {{ owner: TabBodyOwner }} props */
  init(props) {
    this.owner = props.owner;
  }

  render() {
    return this.owner.renderTabBody();
  }
}
