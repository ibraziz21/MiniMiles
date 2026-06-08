import type { Abi } from "viem";

export const FARKLE_TICKET_ADDRESS = process.env.NEXT_PUBLIC_FARKLE_TICKET_ADDRESS as
  | `0x${string}`
  | undefined;

export const farkleTicketAbi: Abi = [
  {
    type: "function",
    name: "buyTicketPack",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "ticketBalance",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticketsPerPack",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "milesPerPack",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "TicketsPurchased",
    inputs: [
      { name: "user",         type: "address", indexed: true  },
      { name: "ticketAmount", type: "uint256", indexed: false },
      { name: "milesBurned",  type: "uint256", indexed: false },
    ],
  },
];
