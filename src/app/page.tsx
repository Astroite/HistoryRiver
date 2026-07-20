import type { Metadata } from "next";
import { HistoryRiver } from "./history-river";

export const metadata: Metadata = {
  title: "落九川｜年度人物轨迹",
  description:
    "站在今天的人民光海之畔，仰望由跨时代核心人物逐年轨迹构成的中国历史长河。",
};

export default function Home() {
  return <HistoryRiver />;
}
