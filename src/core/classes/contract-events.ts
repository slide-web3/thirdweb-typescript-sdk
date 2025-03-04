import { ContractWrapper } from "./contract-wrapper";
import { BaseContract, providers } from "ethers";
import { EventType } from "../../constants";
import { ListenerFn } from "eventemitter3";
import { EventFragment } from "@ethersproject/abi";
import { ContractEvent } from "../../types/index";

/**
 * Listen to Contract events in real time
 * @public
 */
export class ContractEvents<TContract extends BaseContract> {
  private contractWrapper;

  constructor(contractWrapper: ContractWrapper<TContract>) {
    this.contractWrapper = contractWrapper;
  }

  /**
   * Subscribe to transactions in this contract.
   * @remarks Will emit an "event" object containing the transaction status ('submitted' and 'completed') and hash
   * @example
   * ```javascript
   * contract.events.addTransactionListener((event) => {
   *   console.log(event);
   * }
   * ```
   * @param listener - the receiver that will be called on every transaction
   * @public
   */
  public addTransactionListener(listener: ListenerFn) {
    this.contractWrapper.addListener(EventType.Transaction, listener);
  }

  /**
   * Remove a transaction listener
   * @param listener - the receiver to remove
   * @public
   */
  public removeTransactionListener(listener: ListenerFn) {
    this.contractWrapper.off(EventType.Transaction, listener);
  }

  /**
   * Subscribe to contract events
   * @remarks You can add a listener for any contract event to run a function when
   * the event is emitted. For example, if you wanted to listen for a "TokensMinted" event,
   * you could do the following:
   * @example
   * ```javascript
   * contract.events.addEventListener("TokensMinted", (event) => {
   *   console.log(event);
   * });
   * ```
   * @public
   * @param eventName - the event name as defined in the contract
   * @param listener - the receiver that will be called on every new event
   */
  public addEventListener(
    eventName: keyof TContract["filters"] | (string & {}),
    listener: (event: Record<string, any>) => void,
  ) {
    // validates event, throws error if not found
    const event = this.contractWrapper.readContract.interface.getEvent(
      eventName as string,
    );
    this.contractWrapper.readContract.on(event.name, (...args) => {
      // convert event info into nice object with named properties
      const results = this.toContractEvent(event, args);
      listener(results);
    });
  }

  /**
   * Listen to all events emitted from this contract
   * @param listener - the receiver that will be called on every new event
   * @example
   * ```javascript
   * contract.events.listenToAllEvents((event) => {
   *   console.log(event.eventName) // the name of the emitted event
   *   console.log(event.data) // event payload
   * }
   * ```
   */
  public listenToAllEvents(listener: (event: ContractEvent) => void) {
    const address = this.contractWrapper.readContract.address;
    const filter = { address };
    this.contractWrapper.getProvider().on(filter, (log) => {
      try {
        const parsedLog =
          this.contractWrapper.readContract.interface.parseLog(log);
        listener(this.toContractEvent(parsedLog.eventFragment, parsedLog.args));
      } catch (e) {
        console.error("Could not parse event:", log, e);
      }
    });
  }

  /**
   * @public
   * @param eventName - the event name as defined in the contract
   * @param listener - the listener to unregister
   */
  public removeEventListener(
    eventName: keyof TContract["filters"] | (string & {}),
    listener: providers.Listener,
  ) {
    // validates event, throws error if not found
    const event = this.contractWrapper.readContract.interface.getEvent(
      eventName as string,
    );
    this.contractWrapper.readContract.off(event.name as string, listener);
  }

  /**
   * Remove all listeners on this contract
   */
  public removeAllListeners() {
    this.contractWrapper.readContract.removeAllListeners();
    const address = this.contractWrapper.readContract.address;
    const filter = { address };
    this.contractWrapper.getProvider().removeAllListeners(filter);
  }

  private toContractEvent(
    event: EventFragment,
    args: ReadonlyArray<any>,
  ): ContractEvent {
    const results: Record<string, any> = {};
    event.inputs.forEach((param, index) => {
      if (Array.isArray(args[index])) {
        const obj: Record<string, any> = {};
        const components = param.components;
        if (components) {
          const arr = args[index];
          for (let i = 0; i < components.length; i++) {
            const name = components[i].name;
            obj[name] = arr[i];
          }
          results[param.name] = obj;
        }
      } else {
        results[param.name] = args[index];
      }
    });
    return {
      eventName: event.name,
      data: results,
    };
  }
}
