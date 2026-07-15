import type { Metadata } from "next";
import { HistoryRiver } from "./history-river";

export const metadata: Metadata = {
  title: "史河：九天来流｜交互原型",
  description:
    "站在今天的人民光海之畔，仰望由人物、事件与思想构成的中国历史长河。",
};

export default function Home() {
  return <HistoryRiver />;
}
